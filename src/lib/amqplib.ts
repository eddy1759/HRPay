import amqp, { Channel, Connection, ConsumeMessage, Options } from 'amqplib';
import { EventEmitter } from 'events';
import env from '../config/env';
import logger from '../config/logger'; // Import the application logger

/**
 * Wrapper class for AMQP (RabbitMQ) connection and channel management
 */
class AMQPWrapper extends EventEmitter {
	private connection: Connection | null = null;
	private channels: Map<string, Channel> = new Map();
	private reconnectTimeout: NodeJS.Timeout | null = null;
	private readonly url: string;
	private readonly maxReconnectAttempts: number;
	private reconnectAttempts: number = 0;
	private readonly initialReconnectDelay: number;
	private readonly maxReconnectDelay: number;
	private isExplicitlyClosing: boolean = false; // Flag to prevent reconnect on intentional close

	constructor() {
		super();
		this.url = env.RABBITMQ_URL!;
		this.maxReconnectAttempts = 10; // Consider making configurable
		this.initialReconnectDelay = 1000; // 1 second
		this.maxReconnectDelay = 30000; // 30 seconds
	}

	public async initialize(): Promise<void> {
		this.isExplicitlyClosing = false;
		logger.info('Initializing RabbitMQ connection...'); // Log initialization start
		try {
			await this.connect();
			// Success log moved to startup.ts after initialize() resolves
		} catch (error) {
			logger.error(
				{ err: error },
				'Failed to initialize RabbitMQ connection during startup.'
			);
			// Decide if startup should fail or continue without RabbitMQ
			throw error; // Propagate error to fail startup if RabbitMQ is critical
		}
	}

	private async connect(): Promise<void> {
		if (this.connection) {
			logger.warn('Attempted to connect when already connected.');
			return;
		}
		if (this.isExplicitlyClosing) {
			logger.info('Connection attempt aborted, closing explicitly.');
			return;
		}

		try {
			this.connection = await amqp.connect(this.url);
			this.connection.on('error', this.handleConnectionError.bind(this));
			this.connection.on('close', this.handleConnectionClose.bind(this));
			// logger.info('Successfully connected to RabbitMQ'); // Log moved to startup.ts
			this.emit('connected');
			this.reconnectAttempts = 0; // Reset attempts on successful connection
			if (this.reconnectTimeout) {
				clearTimeout(this.reconnectTimeout); // Clear any pending reconnect timeout
				this.reconnectTimeout = null;
			}
			logger.info('RabbitMQ connection established.'); // Log successful connection internally
			// Re-establish any necessary channels/consumers if needed after reconnect
			await this.reinitializeChannels();
		} catch (error) {
			logger.error({ err: error }, 'Error connecting to RabbitMQ');
			this.connection = null; // Ensure connection is null on failure
			// Schedule reconnect only if not explicitly closing
			if (!this.isExplicitlyClosing) {
				this.scheduleReconnect();
			}
			throw error; // Re-throw to signal connection failure
		}
	}

	private handleConnectionError(error: Error): void {
		// Ignore ECONNRESET errors which are common and often handled by 'close'
		if ((error as any).code !== 'ECONNRESET') {
			logger.error({ err: error }, 'RabbitMQ connection error');
		}
		// Connection 'close' event usually follows 'error', reconnect logic is handled there.
	}

	private handleConnectionClose(): void {
		if (this.isExplicitlyClosing) {
			logger.info('RabbitMQ connection closed explicitly.');
			return;
		}
		logger.warn('RabbitMQ connection closed unexpectedly. Attempting to reconnect...');
		this.connection = null;
		this.channels.clear(); // Clear channels on close
		this.scheduleReconnect(); // Attempt to reconnect
	}

	private scheduleReconnect(): void {
		if (this.isExplicitlyClosing || this.reconnectTimeout) {
			// Don't schedule if closing or already scheduled
			return;
		}

		if (this.reconnectAttempts >= this.maxReconnectAttempts) {
			logger.error(
				`Max RabbitMQ reconnect attempts (${this.maxReconnectAttempts}) reached. Giving up.`
			);
			this.emit('failed'); // Emit an event indicating permanent failure
			return; // Stop trying
		}

		const delay = Math.min(
			this.initialReconnectDelay * Math.pow(2, this.reconnectAttempts),
			this.maxReconnectDelay
		);

		this.reconnectAttempts++;
		logger.info(
			`Scheduling RabbitMQ reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`
		);

		this.reconnectTimeout = setTimeout(async () => {
			this.reconnectTimeout = null; // Clear the timeout ID before attempting
			logger.info(
				`Attempting RabbitMQ reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`
			);
			try {
				await this.connect();
				// If successful, connect() resets reconnectAttempts and clears timeout
			} catch (error) {
				// Connect failed, error already logged in connect().
				// handleConnectionClose should trigger scheduleReconnect again if the connection attempt failed and closed.
				// If connect throws but doesn't trigger close, we might need to reschedule here, but amqplib usually triggers 'close'.
				logger.warn(`Reconnect attempt ${this.reconnectAttempts} failed.`);
				// No need to call scheduleReconnect here, 'close' handler does it.
			}
		}, delay);
	}

	// Method to re-setup channels after a reconnect (if needed)
	private async reinitializeChannels(): Promise<void> {
		// Example: If you have predefined queues/consumers, re-assert them here
		// try {
		//     await this.assertQueue('some_important_queue', { durable: true });
		//     logger.info('Re-asserted queue: some_important_queue');
		//     // Re-start consumers if necessary
		// } catch (error) {
		//     logger.error({ err: error }, 'Failed to reinitialize channels after reconnect');
		// }
	}

	private async getOrCreateChannel(queue: string): Promise<Channel> {
		if (!this.connection) {
			logger.error('Cannot create channel, RabbitMQ connection not available.');
			throw new Error('RabbitMQ Connection not initialized');
		}

		let channel = this.channels.get(queue);
		if (channel) {
			return channel; // Return existing channel
		}

		try {
			channel = await this.connection.createChannel();
			channel.on('error', (error: Error) => this.handleChannelError(queue, error));
			channel.on('close', () => this.handleChannelClose(queue));
			await channel.assertQueue(queue, { durable: true }); // Assert queue when channel is created
			this.channels.set(queue, channel);
			logger.info(`Created and asserted RabbitMQ channel/queue: ${queue}`);
			return channel;
		} catch (error) {
			logger.error(
				{ err: error, queue },
				`Failed to create RabbitMQ channel for queue ${queue}`
			);
			throw error; // Propagate error
		}
	}

	private handleChannelError(queue: string, error: Error): void {
		logger.error({ err: error, queue }, `RabbitMQ channel error for queue ${queue}`);
		// Consider closing/recreating the channel or handling specific errors
		this.channels.delete(queue); // Remove potentially broken channel
	}

	private handleChannelClose(queue: string): void {
		logger.warn(`RabbitMQ channel closed for queue ${queue}`);
		this.channels.delete(queue);
		// Optionally attempt to recreate the channel immediately or wait for next use
		// Consider the implications if a consumer was attached to this channel
	}

	public async publishMessage(
		queue: string,
		message: any | any[],
		options: Options.Publish = {}
	): Promise<boolean> {
		try {
			const channel = await this.getOrCreateChannel(queue);
			const messagesToPublish = Array.isArray(message) ? message : [message];

			// Using Promise.all ensures all messages are attempted to be sent.
			// Note: sendToQueue is technically asynchronous but returns boolean immediately.
			// Waiting for drain event might be needed for high throughput scenarios.
			const results = messagesToPublish.map((msg) =>
				channel.sendToQueue(queue, Buffer.from(JSON.stringify(msg)), {
					persistent: true, // Ensure messages survive broker restart
					...options,
				})
			);

			// Check if any sendToQueue returned false (indicating buffer full)
			if (results.some((result) => !result)) {
				logger.warn(
					`RabbitMQ buffer full for queue ${queue}. Message(s) may be dropped or delayed.`
				);
				// Optionally wait for 'drain' event before resolving or returning false
				// await new Promise(resolve => channel.once('drain', resolve));
				// return false; // Indicate potential issue
			}

			// logger.debug(`Published ${messagesToPublish.length} message(s) to queue ${queue}`);
			return true; // Indicates messages were accepted by the channel buffer
		} catch (error) {
			logger.error({ err: error, queue }, `Error publishing message(s) to queue ${queue}`);
			return false; // Indicate failure
		}
	}

	public async consumeMessages(
		queue: string,
		callback: (message: any) => Promise<void>, // Simplified: process one message at a time
		options: Options.Consume = { noAck: false }, // Default to manual acknowledgment
		concurrency: number = 1 // How many messages to process concurrently
	): Promise<void> {
		try {
			const channel = await this.getOrCreateChannel(queue);
			await channel.prefetch(concurrency); // Process 'concurrency' messages at a time

			logger.info(`Starting consumer for queue ${queue} with concurrency ${concurrency}`);

			await channel.consume(
				queue,
				async (msg: ConsumeMessage | null) => {
					if (msg) {
						let messageContent: any;
						try {
							messageContent = JSON.parse(msg.content.toString());
						} catch (parseError) {
							logger.error(
								{ err: parseError, queue },
								'Failed to parse message content from queue'
							);
							channel.nack(msg, false, false); // Discard unparseable message
							return;
						}

						try {
							await callback(messageContent);
							channel.ack(msg); // Acknowledge message success
						} catch (processingError) {
							logger.error(
								{ err: processingError, queue, message: messageContent },
								`Error processing message from queue ${queue}`
							);
							// Decide whether to requeue based on the error type
							channel.nack(msg, false, false); // false: don't requeue failed message (move to DLQ if configured)
						}
					}
				},
				options // Pass consumer options (like noAck)
			);
		} catch (error) {
			logger.error({ err: error, queue }, `Error setting up consumer for queue ${queue}`);
			throw error; // Propagate error to potentially stop the service or retry setup
		}
	}

	public isConnected(): boolean {
		// Check if connection exists and is not closing
		return this.connection !== null && !this.connection.connection?.stream?.destroyed;
	}

	public async close(): Promise<void> {
		this.isExplicitlyClosing = true; // Signal intentional close
		if (this.reconnectTimeout) {
			clearTimeout(this.reconnectTimeout);
			this.reconnectTimeout = null;
		}

		logger.info('Closing RabbitMQ connection...');
		try {
			// Close channels first
			await Promise.allSettled(
				Array.from(this.channels.values()).map((channel) => channel.close())
			);
			this.channels.clear();

			if (this.connection) {
				await this.connection.close();
				this.connection = null;
			}
			logger.info('RabbitMQ connection closed gracefully.');
		} catch (error) {
			logger.error({ err: error }, 'Error during RabbitMQ connection close');
		} finally {
			this.connection = null; // Ensure connection is null
			this.emit('closed'); // Emit event indicating closed connection
		}
	}

	// Simple health check - checks if connection object exists
	public async healthCheck(): Promise<boolean> {
		return this.isConnected();
		// For a more robust check, you could try publishing/consuming a test message
		// or using the RabbitMQ Management API if available.
	}

	// Expose basic channel operations if needed directly
	public async assertQueue(queue: string, options: Options.AssertQueue = {}): Promise<void> {
		try {
			const channel = await this.getOrCreateChannel(queue);
			await channel.assertQueue(queue, { durable: true, ...options });
		} catch (error) {
			logger.error({ err: error, queue }, `Failed to assert queue ${queue}`);
			throw error;
		}
	}

	public async sendToQueue(
		queue: string,
		message: any,
		options: Options.Publish = {}
	): Promise<boolean> {
		// This is essentially a wrapper for publishMessage with a single message
		return this.publishMessage(queue, message, options);
	}
}

export const amqpWrapper = new AMQPWrapper();
