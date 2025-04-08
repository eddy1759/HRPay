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
import { InternalServerError } from '../utils/ApiError';
import { inviteUtils } from '@/modules/invitation/invite.utils';

interface SMTPConfig {
	host: string;
	port: number;
	secure: boolean;
	user: string;
	pass: string;
}

const validateSmtpConfig = (config: Partial<SMTPConfig>): SMTPConfig => {
	const errors: string[] = [];
	if (!config.host) errors.push('SMTP_HOST is required');
	if (!config.port || isNaN(Number(config.port))) errors.push('SMTP_PORT must be a valid number');
	if (!config.user) errors.push('SMTP_USER is required');
	if (!config.pass) errors.push('SMTP_PASS is required');

	if (errors.length > 0) {
		throw new Error(`Invalid SMTP configuration: ${errors.join(', ')}`);
	}
	return config as SMTPConfig;
};

const SMTPConfig: SMTPConfig = validateSmtpConfig({
	host: env.SMTP_HOST,
	port: Number(env.SMTP_PORT),
	secure: env.SMTP_SECURE !== undefined ? env.SMTP_SECURE === 'true' : env.SMTP_PORT === 465,
	user: env.SMTP_USER,
	pass: env.SMTP_PASS,
});

const transportOptions = {
	host: SMTPConfig.host,
	port: SMTPConfig.port,
	secure: SMTPConfig.secure,
	auth: {
		user: SMTPConfig.user,
		pass: SMTPConfig.pass,
	},
	pool: true,
	greetingTimeout: 15000,
	socketTimeout: 15000,
};

const DEFAULT_FROM = `"Payroll Pro" <${env.SMTP_USER}>`;
const TEMPLATES_DIR = path.join(__dirname, '..', 'emails', 'templates');

interface SendTemplateEmailOptions {
	to: string;
	subject: string;
	context?: Record<string, any>;
	attachments?: Mail.Attachment[];
	from?: string;
	template: string;
}
export class EmailService {
	private transporter: Transporter;
	private templates: Map<string, handlebars.TemplateDelegate> = new Map();

	constructor(transporterOpts: SMTPTransportOptions) {
		try {
			this.transporter = nodemailer.createTransport(transporterOpts);
			logger.info('Nodemailer transporter created successfully.');
			this.verifyConnection();
		} catch (error) {
			logger.error('Failed to create Nodemailer transporter:', error);
			throw new Error('Failed to initialize email service.');
		}
	}

	/**
	 * Verifies the Nodemailer transporter connection. Logs status.
	 * @param throwError - If true, throws error on verification failure.
	 * @returns {Promise<boolean>} True if verification succeeds.
	 */
	async verifyConnection(throwError = false): Promise<boolean> {
		try {
			await this.transporter.verify();
			logger.info('Nodemailer transporter connection verified successfully.');
			return true;
		} catch (error) {
			logger.error('Nodemailer transporter connection verification failed:', error);
			if (throwError) {
				throw new Error('SMTP connection verification failed.');
			}
			return false;
		}
	}

	/**
	 * Loads and compiles a Handlebars template. Caches compiled templates.
	 * @param templateName - The name of the template file (without .hbs extension)
	 * @returns Compiled Handlebars template delegate
	 * @throws {Error} If template file cannot be read or compiled
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
			logger.debug(`Template '${templateName}' loaded and compiled.`);
			return compiledTemplate;
		} catch (error: any) {
			logger.error(
				`Failed to load or compile template '${templateName}' from ${templatePath}: ${error.message}`
			);
			throw new Error(`Could not load email template: ${templateName}`);
		}
	}

	/**
	 * Renders an email template with the given context.
	 * @param templateName - Name of the template (without .hbs extension)
	 * @param context - Data object for the template
	 * @returns Rendered HTML string
	 * @throws {Error} If template rendering fails
	 */
	private async _renderTemplate(
		templateName: string,
		context: Record<string, any>
	): Promise<string> {
		try {
			const template = await this._getCompiledTemplate(templateName);
			return template(context);
		} catch (error: any) {
			logger.error(`Error rendering template '${templateName}': ${error.message}`, {
				context,
			});
			throw new Error(`Failed to render email template: ${templateName}`);
		}
	}

	/**
	 * Sends an email using a pre-defined template.
	 * Generates plain text version automatically from HTML.
	 * @param options - Options including recipient, subject, template name, and context.
	 * @throws {Error} If sending fails or input is invalid.
	 */
	async sendTemplatedEmail(options: SendTemplateEmailOptions): Promise<void> {
		const { to, subject, template, context, attachments, from } = options;

		try {
			// --- Render HTML Template ---
			const htmlContent = await this._renderTemplate(template, context);

			// --- Generate Plain Text from HTML ---
			const textContent = convert(htmlContent, {
				wordwrap: 80,
			});

			// --- Prepare Mail Payload ---
			const mailPayload: SendMailOptions = {
				from: from || DEFAULT_FROM,
				to: to,
				subject: subject,
				html: htmlContent,
				text: textContent,
				attachments: attachments,
			};

			// --- Send Email ---
			const info = await this.transporter.sendMail(mailPayload);
			logger.info(
				{ messageId: info.messageId, recipients: to, subject: subject, template: template },
				'Templated email sent successfully'
			);
		} catch (error: any) {
			logger.error(
				{ err: error, recipients: to, subject: subject, template: template },
				'Failed to send templated email'
			);
			// Re-throw a generic error to be handled by the caller
			throw new Error(`Failed to send email: ${error.message || 'Unknown error'}`);
		}
	}
	async sendVerificationEmail(email: string, token: string, name?: string): Promise<void> {
		const isProduction = env.NODE_ENV === 'production';
		const baseUrl = isProduction ? env.FRONTEND_URL : 'http://localhost:3000';
		const verificationLink = `${baseUrl}/api/v1/auth/verify-email?token=${token}`;
		const expiryInfo = env.JWT_VERIFICATION_EXPIRY || 'a limited time';

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

	async sendWelcomeEmail(email: string, name?: string): Promise<void> {
		await this.sendTemplatedEmail({
			to: email,
			subject: 'Welcome to Payroll Pro!',
			template: 'welcomeEmail',
			context: {
				name: name, // Pass name (can be undefined, handled by template #if)
			},
		});
	}

	async sendUserInvitation(
		companyName: string,
		email: string,
		invitationUrl: string
	): Promise<void> {
		await this.sendTemplatedEmail({
			to: email,
			subject: `Invitation to join ${companyName} on Payroll Pro`,
			template: 'invitationEmail',
			context: {
				recipientName: email.slice(0, email.indexOf('@')),
				companyName: companyName,
				invitationUrl: invitationUrl,
			},
		});
	}

	/**
	 * Example: Sends an email with an attachment.
	 * @param to - Recipient email
	 * @param subject - Email subject
	 * @param bodyText - Plain text body
	 * @param filePath - Path to the file to attach
	 * @param fileName - Optional: desired name for the attached file
	 */
	async sendEmailWithAttachment(
		to: string,
		subject: string,
		bodyText: string,
		filePath: string,
		fileName?: string
	): Promise<void> {
		try {
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
				{ err: error, recipient: to, subject: subject },
				'Failed to send email with attachment'
			);
			throw new Error(
				`Failed to send email with attachment: ${error.message || 'Unknown error'}`
			);
		}
	}
}

export const emailService = new EmailService(transportOptions);
