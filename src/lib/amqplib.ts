import amqp, { Channel, Connection, ConsumeMessage, Options } from 'amqplib';
import { EventEmitter } from 'events';
import env from '../config/env';
import logger from '../config/logger'; 

interface QueueSetupOptions {
    queueName: string;
    options?: Options.AssertQueue;
    deadLetterExchange?: string;
    deadLetterQueueName?: string;
    deadLetterRoutingKey?: string; // Routing key for messages going to DLX
}

/**
 * Wrapper class for AMQP (RabbitMQ) connection and channel management
 */
class AMQPWrapper extends EventEmitter {
	private connection: Connection | null = null;
	private channels: Map<string, Channel> = new Map();
	private consumerChannels: Map<string, Channel> = new Map();
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

	private async reinitializeChannels(): Promise<void> {
        logger.info('Reinitializing channels and consumers after connection.');
        // Example: Re-assert known queues/exchanges if necessary
        // for (const queueName of this.consumerChannels.keys()) {
        //     try {
        //         // You might need to store consumer callbacks and options to restart them
        //         logger.info(`Attempting to re-establish consumer for queue: ${queueName}`);
        //         // await this.consumeMessages(queueName, storedCallback, storedOptions, storedConcurrency);
        //     } catch (error) {
        //          logger.error({ err: error, queue: queueName }, `Failed to re-establish consumer for queue ${queueName}`);
        //     }
        // }
        // Add logic here if you need to automatically restart consumers upon reconnection.
        // This example focuses on setup via startPayrollJobProcessor.
    }

	/**
     * Sets up a queue with optional Dead Letter Exchange configuration.
     */
    public async setupQueueWithDLX(config: QueueSetupOptions): Promise<void> {
        const {
            queueName,
            options = { durable: true },
            deadLetterExchange,
            deadLetterQueueName,
            deadLetterRoutingKey = queueName // Default DL routing key to queue name
        } = config;

        try {
            const channel = await this.getOrCreateChannel(`setup-${queueName}`);
            logger.info(`Setting up queue [${queueName}] with DLX config...`);

            // 1. Declare DLX (if specified)
            if (deadLetterExchange) {
                await channel.assertExchange(deadLetterExchange, 'direct', { durable: true });
                logger.info(`Dead Letter Exchange [${deadLetterExchange}] asserted.`);
            }

            // 2. Declare Dead Letter Queue (if specified)
            if (deadLetterExchange && deadLetterQueueName) {
                await channel.assertQueue(deadLetterQueueName, { durable: true });
                logger.info(`Dead Letter Queue [${deadLetterQueueName}] asserted.`);
                // 3. Bind DLQ to DLX
                await channel.bindQueue(deadLetterQueueName, deadLetterExchange, deadLetterRoutingKey);
                logger.info(`Dead Letter Queue [${deadLetterQueueName}] bound to DLX [${deadLetterExchange}] with key [${deadLetterRoutingKey}].`);
            }

            // 4. Declare Main Queue with DLX arguments (if specified)
            const queueArgs = options.arguments || {};
            if (deadLetterExchange) {
                queueArgs['x-dead-letter-exchange'] = deadLetterExchange;
                if (deadLetterRoutingKey) {
                    queueArgs['x-dead-letter-routing-key'] = deadLetterRoutingKey;
                }
            }
            await channel.assertQueue(queueName, { ...options, arguments: queueArgs });
            logger.info(`Main queue [${queueName}] asserted with DLX arguments.`);

        } catch (error) {
            logger.error({ err: error, queue: queueName }, `Failed to setup queue [${queueName}] with DLX.`);
            throw error;
        }
    }


	public async publishMessage(
		queue: string,
		message: any | any[],
		options: Options.Publish = {}
	): Promise<boolean> {
		try {
			const channel = await this.getOrCreateChannel(`publish-${queue}`);
			const messagesToPublish = Array.isArray(message) ? message : [message];

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
				
				await new Promise(resolve => channel.once('drain', resolve));
				logger.info(`RabbitMQ drain event received for queue ${queue}.`)
				return false; // Indicate potential issue
			}

			// logger.debug(`Published ${messagesToPublish.length} message(s) to queue ${queue}`);
			return true; // Indicates messages were accepted by the channel buffer
		} catch (error) {
			logger.error({ err: error, queue }, `Error publishing message(s) to queue ${queue}`);
			return false; // Indicate failure
		}
	}

	public async consumeMessages<T = any>(
        queue: string,
        callback: (message: T) => Promise<boolean>,
        options: Options.Consume = { noAck: false }, // Explicitly default to manual ACK
        concurrency: number = 1
    ): Promise<{ consumerTag: string; channel: Channel }> {
        if (options.noAck === true) {
             logger.warn(`Consumer for queue ${queue} started with noAck=true. Message loss possible.`);
        }
         if (this.consumerChannels.has(queue)) {
            logger.warn(`Consumer already exists for queue ${queue}. Skipping.`);
            // Or potentially throw an error, depending on desired behavior
            throw new Error(`Consumer already registered for queue ${queue}`);
         }


        try {
            // Create or get a dedicated channel for this consumer to manage prefetch correctly
            const channel = await this.getOrCreateChannel(`consumer-${queue}`);
            await channel.prefetch(concurrency);
            this.consumerChannels.set(queue, channel); // Track consumer channel

            logger.info(`Starting consumer for queue ${queue} with concurrency ${concurrency}`);

            const { consumerTag } = await channel.consume(
                queue,
                async (msg: ConsumeMessage | null) => {
                    if (msg) {
                        let messageContent: T;
                        try {
                            messageContent = JSON.parse(msg.content.toString()) as T;
                        } catch (parseError) {
                            logger.error( { err: parseError, queue, messageId: msg.properties.messageId }, 'Failed to parse message content');
                            // Discard unparseable message - permanent failure
                            channel.nack(msg, false, false);
                            return;
                        }

                        try {
                            // Call the provided processing function
                            const success = await callback(messageContent);

                            // MODIFIED ACK/NACK Logic
                            if (success) {
                                channel.ack(msg); // Acknowledge success
                                // logger.debug(`Message processed successfully, ACK sent. Queue: ${queue}`);
                            } else {
                                logger.warn(`Processing callback returned false for message. NACKing (no requeue). Queue: ${queue}, MsgId: ${msg.properties.messageId}`);
                                channel.nack(msg, false, false); // Permanent failure indicated by callback
                            }
                        } catch (processingError) {
                            logger.error( { err: processingError, queue, messageId: msg.properties.messageId, message: messageContent }, `Error processing message from queue ${queue}. NACKing (no requeue).` );
                            // Treat errors as permanent failures for this consumer, rely on DLX
                            channel.nack(msg, false, false);
                        }
                    } else {
                         logger.warn(`Received null message for queue ${queue}, possibly due to queue deletion.`);
                         // Channel might be closing or queue deleted
                         this.consumerChannels.delete(queue); // Assume consumer is dead
                    }
                },
                // Ensure noAck is false unless explicitly overridden
                { ...options, noAck: false }
            );
             logger.info(`Consumer started for queue ${queue} with consumerTag [${consumerTag}]`);
             return { consumerTag, channel }; // Return tag and channel for potential cancellation

        } catch (error) {
            logger.error({ err: error, queue }, `Error setting up consumer for queue ${queue}`);
             this.consumerChannels.delete(queue); // Clean up tracking if setup failed
            throw error;
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
