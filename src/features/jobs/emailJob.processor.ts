import { z } from 'zod'; 
import logger from '@/config/logger';
import { amqpWrapper } from '@/lib/amqplib';
import { emailService } from '@/emails/email.service';

const MAX_RETRIES = 5; // Example configuration
const INITIAL_RETRY_DELAY_MS = 1000;
// --- Define Zod Schemas for Validation ---

const BaseEmailPayloadSchema = z.object({
    to: z.string().email({ message: "Invalid email address" }),
    retryCount: z.number().int().min(0).optional(), 
});


const VerificationPayloadSchema = BaseEmailPayloadSchema.extend({
    type: z.literal('verification'),
    token: z.string({ required_error: "Verification token is required" }).min(1),
    name: z.string().optional(),
});


const InvitePayloadSchema = BaseEmailPayloadSchema.extend({
    type: z.literal('invite'),
    companyName: z.string({ required_error: "Company name is required for invite" }).min(1),
    invitationUrl: z.string({ required_error: "Invitation URL is required" }).url({ message: "Invalid invitation URL" }),
});


const WelcomePayloadSchema = BaseEmailPayloadSchema.extend({
    type: z.literal('welcome'),
    name: z.string().optional(),
    companyName: z.string().optional(), // Optional for welcome emails
});


// --- Discriminated Union for type safety ---
const EmailJobPayloadSchema = z.discriminatedUnion("type", [
    VerificationPayloadSchema,
    InvitePayloadSchema,
    WelcomePayloadSchema,
]);

// --- Define the TypeScript type from the Zod schema ---
export type EmailJobPayload = z.infer<typeof EmailJobPayloadSchema>;


/**
 * @description - Processes a single email job received from the queue.
 * Validates the payload and calls the appropriate email service method.
 *
 * @param payload - The parsed payload of the email job message.
 * @returns {Promise<boolean>} True if processing is successful, throws error otherwise (implicitly returns false via error handling).
 * @throws {Error} If validation fails or email sending fails.
 */
const processEmailJob = async (rawPayload: unknown): Promise<boolean> => {
    const validationResult = EmailJobPayloadSchema.safeParse(rawPayload);

    if (!validationResult.success) {
        logger.error(
            'Invalid email job payload received. Discarding message.',
            { errors: validationResult.error.flatten().fieldErrors, payload: rawPayload }
        );
        throw new Error(`Invalid payload: ${validationResult.error.message}`);
    }

    
    const payload = validationResult.data;
    const attempt = (payload.retryCount || 0) + 1; 

    logger.info(`Processing email job for type "${payload.type}" to ${payload.to} (Attempt: ${attempt})`);

    
    try {
        switch (payload.type) {
            case 'verification':
                if (!payload.token || !payload.name) {
                    throw new Error("Missing token or name for verification type after validation.");
                }
                await emailService.sendVerificationEmail(payload.to, payload.token, payload.name);
                break;
            case 'invite':
                if (!payload.companyName || !payload.invitationUrl) {
                     throw new Error("Missing companyName or invitationUrl for invite type after validation."); // Should not happen
                }
                await emailService.sendUserInvitation(payload.companyName, payload.to, payload.invitationUrl);
                break;
            case 'welcome':
                if (!payload.companyName) {
                    logger.info(`Sending generic welcome email to ${payload.to}`);
                    await emailService.sendWelcomeEmailOnboarding(payload.to, payload.name);
                }else {
                    logger.info(`Sending company welcome email to ${payload.to} for company ${payload.companyName}`);
                    await emailService.sendCompanyWelcomeEmail(payload.to,  payload.companyName, payload.name);
                }
                break;
            default:
                logger.error(`Unknown email job type: ${(payload as any).type}. Discarding message.`);
                    // Reject/NACK without requeueing
                throw new Error(`Unknown email type: ${(payload as any).type}`);
        }

        logger.info(`Email job processed successfully for type "${payload.type}" to ${payload.to}`);

        return true;

    } catch (error: any) {
        logger.error(`Failed to send email for ${payload.to} (Type: ${payload.type}, Attempt: ${attempt}):`, error);

        if (attempt >= MAX_RETRIES) {
            logger.error(`Maximum retries reached for email job ${payload.type} to ${payload.to}. Moving to DLQ.`);
            throw error; // Rethrow to signal processing failure to MQ consumer
        } else {
            const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1); 
            logger.warn(`Retrying email job ${payload.type} to ${payload.to} in ${delay}ms (Attempt: ${attempt + 1}).`);

            // Modify payload for retry
            const retryPayload = { ...payload, retryCount: attempt };
             throw error; // Rethrow to signal processing failure to MQ consumer
        }
    }
    
};



/**
 * @description - This function is responsible for processing email jobs from the queue.
 * It sets up the queue, handles message consumption, and manages errors.
 * It uses a Dead Letter Exchange (DLX) for failed messages.
 *
 * @returns {Promise<void>} - A promise that resolves when the worker is started successfully.
 */
export const startEmailJobProcessor = async (): Promise<void> => { // Renamed for clarity
    try {
        logger.info('Attempting to start Email Job Processor worker...');

        const queueName = 'email_job_queue';
        const deadLetterExchange = 'email_job_dlx';
        const deadLetterQueueName = 'email_job_dlx_queue';

        await amqpWrapper.setupQueueWithDLX({
            queueName: queueName,
            options: { 
                durable: true, 
                'x-dead-letter-exchange': deadLetterExchange, 
                'x-dead-letter-routing-key': 'email_job_retry' 
            }, // Standard options for main queue
            deadLetterExchange: deadLetterExchange,
            deadLetterQueueName: deadLetterQueueName,
            deadLetterRoutingKey: queueName, 
        });

        logger.info(`Queue [${queueName}] and DLX [${deadLetterExchange}] setup verified.`);

        const concurrency = parseInt(process.env.EMAIL_WORKER_CONCURRENCY || '5', 10); // Increased default
        logger.info(`Starting consumer for ${queueName} with concurrency ${concurrency}`);

        await amqpWrapper.consumeMessages<unknown>( 
            queueName,
            processEmailJob, 
            {}, 
            concurrency
        );

        logger.info(`[*] Email Job Processor worker started successfully. Waiting for messages in '${queueName}'.`);

    } catch (error: any) {
        logger.error('Failed to start or run Email Job Processor worker.', {
             errorMessage: error instanceof Error ? error.message : String(error),
             errorDetails: error // Log the full error object for details
         });
        process.exit(1);
    }
};
