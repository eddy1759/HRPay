import nodemailer from 'nodemailer';
import type { Transporter, SendMailOptions } from 'nodemailer';
import type { Options as SMTPTransportOptions } from 'nodemailer/lib/smtp-transport';
import Mail from 'nodemailer/lib/mailer';
import handlebars from 'handlebars';
import { convert } from 'html-to-text';
import fs from 'fs/promises';
import path from 'path';
import logger from '../config/logger';
import env from '../config/env';


const DEFAULT_FROM = `"Payroll Pro" <${env.SMTP_USER}>`;
const TEMPLATES_DIR = path.join(__dirname, '..', 'emails', 'templates');

/**
 * @interface SMTPConfig
 * @description Defines the structure for SMTP configuration options.
 * @property {string} host - The SMTP server hostname.
 * @property {number} port - The SMTP server port.
 * @property {boolean} secure - Whether to use a secure connection (TLS/SSL). Typically true for port 465, false otherwise.
 * @property {string} user - The username for SMTP authentication.
 * @property {string} pass - The password for SMTP authentication.
 */
interface SMTPConfig {
	host: string;
	port: number;
	secure: boolean;
	user: string;
	pass: string;
}


/**
 * @description - Validates the essential SMTP configuration properties extracted from environment variables.
 * Throws an error if any required configuration is missing or invalid.
 * @param {Partial<SMTPConfig>} config - A potentially incomplete SMTP configuration object.
 * @returns {SMTPConfig} The validated and complete SMTP configuration object.
 * @throws {Error} If validation fails, listing the missing or invalid fields.
 */
const validateSmtpConfig = (config: Partial<SMTPConfig>): SMTPConfig => {
	const errors: string[] = [];
	if (!config.host) errors.push('SMTP_HOST is required');
	if (config.port === undefined || config.port === null || isNaN(Number(config.port)))
        errors.push('SMTP_PORT must be a valid number');
	if (config.secure === undefined) {
        config.secure = Number(config.port) === 465;
    }
	if (!config.user) errors.push('SMTP_USER is required');
	if (!config.pass) errors.push('SMTP_PASS is required');

	if (errors.length > 0) {
		const errorMessage = `Invalid SMTP configuration: ${errors.join(', ')}`;
        logger.error(errorMessage); // Log the error
        throw new Error(errorMessage);
	}
	config.port = Number(config.port);
	return config as SMTPConfig;
};


/**
 * @constant {SMTPConfig} SMTPConfig
 * @description Holds the validated SMTP configuration settings loaded from environment variables.
 */
const SMTPConfig: SMTPConfig = validateSmtpConfig({
	host: env.SMTP_HOST,
	port: env.SMTP_PORT ? Number(env.SMTP_PORT) : undefined, // Pass potential undefined to validator
	secure: env.SMTP_SECURE !== undefined ? env.SMTP_SECURE === 'true' : undefined,
	user: env.SMTP_USER,
	pass: env.SMTP_PASS,
});


/**
 * @constant {SMTPTransportOptions} transportOptions
 * @description Configuration options for the Nodemailer SMTP transport.
 * Includes connection pooling and timeout settings for robustness.
 */
const transportOptions = {
	host: SMTPConfig.host,
	port: SMTPConfig.port,
	secure: SMTPConfig.secure,
	auth: {
		user: SMTPConfig.user,
		pass: SMTPConfig.pass,
	},
	pool: true,
	maxConnections: 5,
	maxMessages: 100,
	greetingTimeout: 15000,
	socketTimeout: 15000,
	connectionTimeout: 10000, // 10 seconds to establish connection
    logger: env.NODE_ENV !== 'production', // Enable Nodemailer's internal logging in dev/test
    debug: env.NODE_ENV !== 'production', // Enable debug output in dev/test
};



/**
 * @interface SendTemplateEmailOptions
 * @description Options required for sending an email using a template.
 * @property {string} to - The recipient's email address.
 * @property {string} subject - The subject line of the email.
 * @property {string} template - The name of the Handlebars template file (without the .hbs extension).
 * @property {Record<string, any>} [context] - An object containing data to be injected into the template.
 * @property {Mail.Attachment[]} [attachments] - An array of Nodemailer attachment objects.
 * @property {string} [from] - An optional override for the "From" address. Defaults to `DEFAULT_FROM`.
 */
interface SendTemplateEmailOptions {
	to: string;
	subject: string;
	template: string;
	context?: Record<string, any>;
	attachments?: Mail.Attachment[];
	from?: string;
}


/**
 * @class EmailService
 * @description Provides functionalities for sending emails, including templated emails using Handlebars.
 * Manages SMTP transport connection, template caching, and rendering.
 */
class EmailService {
	private transporter: Transporter;
	private templates: Map<string, handlebars.TemplateDelegate> = new Map();

	/**
     * @description - Creates an instance of EmailService.
     * Initializes the Nodemailer transporter with the provided options and verifies the connection.
     * @param {SMTPTransportOptions} transporterOpts - Configuration options for the Nodemailer transporter.
     * @throws {Error} If the transporter cannot be created or the initial connection verification fails.
     */
	constructor(transporterOpts: SMTPTransportOptions) {
		try {
			this.transporter = nodemailer.createTransport(transporterOpts);
			logger.info('Nodemailer transporter created successfully.');
			// this.verifyConnection();
			this.verifyConnection().catch(() => {
                logger.warn('Initial SMTP connection verification failed. Service will attempt to send emails regardless.');
            });
		} catch (error) {
			logger.error('Failed to create Nodemailer transporter:', error[0].message);
			throw new Error(`Failed to initialize email service transporter: ${error[0].message}`);
		}
	}


	/**
     * @description - Verifies the Nodemailer transporter connection and authentication with the SMTP server.
     * Logs the verification status. Updates internal `isVerified` state.
     * @param {boolean} [throwError=false] - If true, throws an error if verification fails. Otherwise, returns false.
     * @returns {Promise<boolean>} A promise that resolves to true if the connection is verified, false otherwise (unless throwError is true).
     * @throws {Error} If `throwError` is true and verification fails.
     */
	async verifyConnection(throwError = false): Promise<boolean> {
		try {
			await this.transporter.verify();
			logger.info('Nodemailer transporter connection verified successfully.');
			return true;
		} catch (error) {
			logger.error('Nodemailer transporter connection verification failed:', { error: error[0].message });
			
			if (throwError) {
				throw new Error(`SMTP connection verification failed: ${error[0].message}`);
			}
			return false;
		}
	}


	/**
     * @description - Retrieves a compiled Handlebars template.
     * Reads the template file from disk, compiles it, and caches it for future use.
     * @private
     * @param {string} templateName - The name of the template file (without the .hbs extension).
     * @returns {Promise<handlebars.TemplateDelegate>} A promise resolving to the compiled Handlebars template function.
     * @throws {Error} If the template file cannot be read or compiled.
     */
	private async _getCompiledTemplate(templateName: string): Promise<handlebars.TemplateDelegate> {
		if (this.templates.has(templateName)) {
			return this.templates.get(templateName)!;
		}

		const templatePath = path.join(TEMPLATES_DIR, `${templateName}.hbs`);
		try {
			const templateSource = await fs.readFile(templatePath, 'utf-8');
			const compiledTemplate = handlebars.compile(templateSource);
			this.templates.set(templateName, compiledTemplate);
			logger.debug(`Template '${templateName}' loaded and compiled from ${templatePath}.`);
			return compiledTemplate;
		} catch (error: any) {
			logger.error(
                `Failed to load or compile template '${templateName}' from ${templatePath}: ${error.message}`
            );
            // Throw a specific error indicating template issues
            throw new Error(`Could not load or compile email template: ${templateName}. Check path and syntax.`);
		}
	}



	 /**
     * @description - Renders an email template with the provided context data.
     * Uses the cached compiled template if available.
     * @private
     * @param {string} templateName - The name of the template file (without the .hbs extension).
     * @param {Record<string, any>} context - The data object to populate the template's placeholders.
     * @returns {Promise<string>} A promise resolving to the rendered HTML string.
     * @throws {Error} If template retrieval or rendering fails.
     */
	private async _renderTemplate(
		templateName: string,
		context: Record<string, any> = {}
	): Promise<string> {
		try {
			const template = await this._getCompiledTemplate(templateName);
			const fullContext = {
                ...context,
                currentYear: new Date().getFullYear(),
            };
			return template(fullContext);
		} catch (error: any) {
			logger.error(`Error rendering template '${templateName}': ${error.message}`, {
				contextKeys: Object.keys(context), // Log only keys to avoid leaking sensitive data
				templateName: templateName,
		   });
		   throw new Error(`Failed to render email template: ${templateName}. ${error.message}`);
		}
	}



	/**
     * @description - Sends an email using a specified Handlebars template.
     * 	*	*	*	*  Renders the HTML content, automatically generates a plain text version from the HTML,
     * 	*	*	*	*  and sends the email using the configured transporter.
     * @param {SendTemplateEmailOptions} options - The options for sending the templated email.
     * @returns {Promise<void>} A promise that resolves when the email is accepted by the transport for delivery.
     * @throws {Error} If rendering the template fails, or if sending the email fails. Includes details from underlying error.
     */
	async sendTemplatedEmail(options: SendTemplateEmailOptions): Promise<void> {
		const { to, subject, template, context = {}, attachments, from = DEFAULT_FROM } = options;

		if (!to || !subject || !template) {
            throw new Error('Missing required options for sending templated email (to, subject, template).');
        }

		try {
			// --- Render HTML Template ---
			const htmlContent = await this._renderTemplate(template, context);

			// --- Generate Plain Text from HTML ---
			const textContent = convert(htmlContent, {
				wordwrap: 80,
				selectors: [ // Improve text conversion
                    { selector: 'a', options: { ignoreHref: false } },
                    { selector: 'img', format: 'skip' }, // Skip images in text version
                ]
			});

			// --- Prepare Mail Payload ---
			const mailPayload: SendMailOptions = {
				from: from,
				to: to,
				subject: subject,
				html: htmlContent,
				text: textContent,
				attachments: attachments,
				headers: { // Add helpful headers
					'X-Mailer': 'PayrollPro Email Service',
					'X-Priority': '3 (Normal)', // 1=High, 3=Normal, 5=Low
				}
			};

			// --- Send Email ---
			const info = await this.transporter.sendMail(mailPayload);
			logger.info(
                'Templated email sent successfully',
                { messageId: info.messageId, response: info.response, recipients: to, subject: subject, template: template }
            );
		} catch (error: any) {
			if (error.message.includes('template')) {
				logger.error(
				   'Failed to send templated email due to template rendering error',
					{ err: error.message, recipients: to, subject: subject, template: template }
				);
			   // Re-throw the original rendering error
			   throw error;
			} else {
                logger.error(
                    'Failed to send templated email via transporter',
                    { err: error.message, code: error.code, command: error.command, recipients: to, subject: subject, template: template }
                );
                 // Re-throw a generic but informative error
                throw new Error(`Failed to send email to ${to} (Subject: ${subject}): ${error.message || 'Unknown SMTP error'}`);
            }
		}
	}


	 /**
     * @description - Sends an email verification link to a user.
     * @param {string} email - The recipient's email address.
     * @param {string} token - The verification token.
     * @param {string} [name] - The recipient's name (optional). Used for personalization.
     * @returns {Promise<void>} A promise that resolves when the email is sent.
     * @throws {Error} If sending the email fails.
     */
	async sendVerificationEmail(email: string, token: string, name?: string): Promise<void> {
		const isProduction = env.NODE_ENV === 'production';
		const baseUrl = isProduction ? env.FRONTEND_URL : 'http://localhost:3000';
		const verificationLink = `${baseUrl}/api/v1/auth/verify-email?token=${token}`;
		const expiryInfo = env.JWT_VERIFICATION_EXPIRY;

		await this.sendTemplatedEmail({
			to: email,
			subject: 'Verify Your Email Address - Payroll Pro',
			template: 'verificationEmail', // Matches filename verificationEmail.hbs
			context: {
				nameOrDefault: name || 'there', // Provide a default if name is not available
				verificationLink: verificationLink,
				expiryInfo: expiryInfo,
			},
		});
	}

	/**
     * @description - Sends a welcome email to a user upon successful account creation and verification (general onboarding).
     * @param {string} email - The recipient's email address.
     * @param {string} [name] - The recipient's name (optional).
     * @returns {Promise<void>} A promise that resolves when the email is sent.
     * @throws {Error} If sending the email fails.
     */
	async sendWelcomeEmailOnboarding(email: string, name?: string): Promise<void> {
		await this.sendTemplatedEmail({
			to: email,
			subject: 'Welcome to Payroll Pro!',
			template: 'welcomeEmail',
			context: {
				name: name, // Pass name (can be undefined, handled by template #if)
			},
		});
	}


	/**
     * @description - Sends a welcome email when a user is added/onboarded to a specific company within Payroll Pro.
     * @param {string} email - The recipient's email address.
     * @param {string} companyName - The name of the company the user is joining.
     * @param {string} [name] - The recipient's name (optional).
     * @returns {Promise<void>} A promise that resolves when the email is sent.
     * @throws {Error} If sending the email fails.
     */
	async sendCompanyWelcomeEmail(email: string, companyName: string, name?: string): Promise<void> {
		await this.sendTemplatedEmail({
			to: email,
			subject: `Welcome to ${companyName} on Payroll Pro!`,
			template: 'welcomeEmail',
			context: {
				companyName: companyName,
				name: name, // Pass name (can be undefined, handled by template #if)
			},
		});
	}


	/**
     * @description - Sends an invitation email to a user to join a specific company on Payroll Pro.
     * @param {string} companyName - The name of the inviting company.
     * @param {string} email - The email address of the invitee.
     * @param {string} invitationUrl - The unique URL for the user to accept the invitation.
     * @returns {Promise<void>} A promise that resolves when the email is sent.
     * @throws {Error} If sending the email fails.
     */
	async sendUserInvitation(
		companyName: string,
		email: string,
		invitationUrl: string
	): Promise<void> {
		if (!companyName || !email || !invitationUrl) {
            throw new Error('Missing required parameters for sending user invitation.');
        }

		const emailParts = email.split('@');
        const recipientNameGuess = emailParts[0].length > 0 ? emailParts[0] : undefined;

		await this.sendTemplatedEmail({
			to: email,
			subject: `Invitation to join ${companyName} on Payroll Pro`,
			template: 'invitationEmail',
			context: {
				recipientName: recipientNameGuess,
				companyName: companyName,
				invitationUrl: invitationUrl,
				recipientEmail: email,
			},
		});
	}

	
	/**
     * @description - Sends a basic email with a file attachment (not using templates).
     * Useful for sending reports, documents, etc.
     * @param {string} to - The recipient's email address.
     * @param {string} subject - The email subject line.
     * @param {string} bodyText - The plain text content of the email body.
     * @param {string} filePath - The absolute or relative path to the file to attach.
     * @param {string} [fileName] - Optional: The desired filename for the attachment as seen by the recipient. Defaults to the base name of the file path.
     * @returns {Promise<void>} A promise that resolves when the email is sent.
     * @throws {Error} If reading the file fails or sending the email fails.
     */
	async sendEmailWithAttachment(
		to: string,
		subject: string,
		bodyText: string,
		filePath: string,
		fileName?: string
	): Promise<void> {
		if (!to || !subject || !bodyText || !filePath) {
			throw new Error('Missing required parameters for sending email with attachment.');
	   	}

		try {
			await fs.access(filePath); // Check if the file exists

			const attachment: Mail.Attachment = {
				path: filePath,
				filename: fileName || path.basename(filePath), // Use provided name or derive from path
			};

			// Use raw sendMail for non-template emails or simple cases
			const info = await this.transporter.sendMail({
				from: DEFAULT_FROM,
				to: to,
				subject: subject,
				text: bodyText, // Only text needed for this example
				attachments: [attachment],
				headers: { 'X-Mailer': 'PayrollPro Email Service' }
			});
			logger.info(
				{
					messageId: info.messageId,
					recipient: to,
					subject: subject,
					attachment: attachment.filename,
				},
				'Email with attachment sent successfully'
			);
		} catch (error: any) {
			logger.error(
                'Failed to send email with attachment',
                { err: error.message, code: error.code, recipient: to, subject: subject, filePath: filePath }
            );
            
            if (error.code === 'ENOENT') {
                 throw new Error(`Failed to send email: Attachment file not found at path: ${filePath}`);
            }
            throw new Error(
                `Failed to send email with attachment to ${to}: ${error.message || 'Unknown error'}`
            );
		}
	}
}

export const emailService = new EmailService(transportOptions);
