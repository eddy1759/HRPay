import { createClient, RedisClientType, RedisClientOptions } from 'redis';
import logger from '../config/logger';
import env from '../config/env'; // Assuming env holds REDIS_URL and potentially other config

// Helper for exponential backoff (reuse or define similarly to the prisma one)
const exponentialBackoff = (attempt: number, baseDelay = 200, maxDelay = 5000) => {
	const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
	return delay + Math.random() * (delay * 0.2); // Add jitter
};

class RedisService {
	private client: RedisClientType | null = null;
	private isConnected: boolean = false;
	private isConnecting: boolean = false;
	private connectionPromise: Promise<void> | null = null;
	private readonly connectionOptions: RedisClientOptions;
	private readonly initialConnectRetries: number;
	private readonly initialConnectBaseDelay: number;

	constructor() {
		if (!env.REDIS_URL) {
			logger.warn('REDIS_URL is not defined. Redis functionality will be disabled.');
			this.connectionOptions = {}; // Set empty options if no URL
		} else {
			this.connectionOptions = {
				url: env.REDIS_URL,
				socket: {
					// Configure built-in reconnection strategy for resilience
					reconnectStrategy: (retries: number): number | Error => {
						if (retries > 10) {
							// Example: Give up after 10 retries
							logger.error('Redis: Too many reconnection attempts. Giving up.');
							this.isConnected = false;
							this.isConnecting = false; // Ensure flags are reset
							// Return an error to stop retrying
							return new Error('Redis reconnection failed after multiple attempts.');
						}
						const delay = exponentialBackoff(retries, 100, 3000); // Use backoff for reconnections too
						logger.info(
							`Redis: Attempting to reconnect (attempt ${retries + 1}). Retrying in ${delay.toFixed(0)}ms...`
						);
						return delay;
					},
					// Optional: Configure connect timeout
					// connectTimeout: 5000 // 5 seconds
				},
			};
		}

		// Configuration for the *initial* connection attempt loop
		this.initialConnectRetries = env.REDIS_INITIAL_CONNECT_RETRIES ?? 5; // Default to 5 retries
		this.initialConnectBaseDelay = env.REDIS_INITIAL_CONNECT_BASE_DELAY ?? 200; // Default to 200ms base delay
	}

	/**
	 * Establishes the initial connection to the Redis server with retry logic.
	 * Subsequent reconnections are handled by the client's reconnectStrategy.
	 * @returns Promise<void> Resolves when connected, rejects if initial connection fails after retries.
	 */
	public async connect(): Promise<void> {
		// Prevent multiple concurrent connection attempts & connect if already connected
		if (this.isConnected) {
			logger.info('Redis client is already connected.');
			return;
		}
		if (this.isConnecting && this.connectionPromise) {
			logger.info(
				'Redis connection attempt already in progress. Waiting for it to complete...'
			);
			return this.connectionPromise;
		}
		if (!env.REDIS_URL) {
			logger.warn('Cannot connect: REDIS_URL is not configured.');
			return Promise.resolve(); // Resolve immediately if no URL is set
		}

		this.isConnecting = true;
		this.connectionPromise = this._performInitialConnection();

		try {
			await this.connectionPromise;
		} finally {
			// Reset connectionPromise once the connection attempt (success or fail) is finished
			this.connectionPromise = null;
			// isConnecting and isConnected state is managed within _performInitialConnection and event handlers
		}
	}

	private async _performInitialConnection(): Promise<void> {
		this.client = createClient(this.connectionOptions) as RedisClientType;
		this._registerEventHandlers(); // Register handlers before connecting

		for (let attempt = 0; attempt < this.initialConnectRetries; attempt++) {
			try {
				logger.info(
					`Attempting to connect to Redis (Attempt ${attempt + 1}/${this.initialConnectRetries})...`
				);
				await this.client.connect();
				return; // Exit loop on successful connect call initiation
			} catch (error: any) {
				logger.error(
					`Failed to initiate Redis connection (Attempt ${attempt + 1}/${this.initialConnectRetries}): ${error.message}`
				);

				// Clean up the failed client instance before retrying
				await this._cleanupClientInstance();

				if (attempt < this.initialConnectRetries - 1) {
					const delay = exponentialBackoff(attempt, this.initialConnectBaseDelay);
					logger.info(`Retrying Redis connection in ${delay.toFixed(0)}ms...`);
					await new Promise((resolve) => setTimeout(resolve, delay));
					// Re-create client for the next attempt
					this.client = createClient(this.connectionOptions) as RedisClientType;
					this._registerEventHandlers();
				}
			}
		}

		// If loop completes without connection
		this.isConnecting = false;
		this.isConnected = false;
		await this._cleanupClientInstance(); // Ensure cleanup after final failure
		throw new Error(
			`Redis initial connection failed after ${this.initialConnectRetries} attempts.`
		);
	}

	/**
	 * Registers event handlers for the Redis client.
	 */
	private _registerEventHandlers(): void {
		if (!this.client) return;

		// Clear existing listeners before attaching new ones (important for retries)
		this.client.removeAllListeners();

		this.client.on('connect', () => {
			logger.info('Redis client is connecting...');
			// Note: Connection isn't fully ready until 'ready' event
		});

		this.client.on('ready', () => {
			logger.info('Redis client connected and ready.');
			this.isConnected = true;
			this.isConnecting = false;
		});

		this.client.on('end', () => {
			logger.warn('Redis client connection closed.');
			this.isConnected = false;
			this.isConnecting = false; // Ensure this is reset if connection ends unexpectedly
		});

		this.client.on('error', (err: Error) => {
			logger.error('Redis Client Error:', err);
			// isConnected state might be updated by 'end' or reconnect logic
		});

		this.client.on('reconnecting', () => {
			logger.info('Redis client is attempting to reconnect...');
			this.isConnecting = true; // Set connecting flag during reconnection
			this.isConnected = false;
		});
	}

	/**
	 * Unregisters event handlers and nullifies the client instance.
	 */
	private async _cleanupClientInstance(): Promise<void> {
		if (this.client) {
			this.client.removeAllListeners();
			// Attempt to quit gracefully, but don't wait indefinitely if it hangs
			try {
				await Promise.race([
					this.client.quit(),
					new Promise((_, reject) =>
						setTimeout(() => reject(new Error('Redis quit timeout')), 2000)
					), // 2s timeout
				]);
			} catch (quitError: any) {
				logger.warn(
					`Error during Redis client cleanup (quit): ${quitError.message}. Forcing disconnect.`
				);
				// Force disconnect if quit fails or times out
				try {
					await this.client.disconnect();
				} catch (disconnectError: any) {
					logger.error(
						`Error during Redis client cleanup (disconnect): ${disconnectError.message}`
					);
				}
			} finally {
				this.client = null;
			}
		}
	}

	/**
	 * Disconnects the Redis client gracefully.
	 * @returns Promise<void>
	 */
	public async disconnect(): Promise<void> {
		if (!this.client || !this.isConnected) {
			logger.info('Redis client is already disconnected or not initialized.');
			await this._cleanupClientInstance(); // Ensure cleanup even if not connected
			this.isConnected = false;
			this.isConnecting = false;
			return;
		}

		logger.info('Disconnecting Redis client...');
		try {
			// Use quit for graceful shutdown (waits for pending commands)
			await this.client.quit();
			logger.info('Redis client disconnected successfully.');
		} catch (error: any) {
			logger.error(
				`Error during Redis graceful disconnect (quit): ${error.message}. Forcing disconnect.`
			);
			try {
				// Fallback to forceful disconnect if quit fails
				await this.client.disconnect();
				logger.info('Redis client forcefully disconnected.');
			} catch (disconnectError: any) {
				logger.error(`Error during Redis forceful disconnect: ${disconnectError.message}`);
			}
		} finally {
			this.isConnected = false;
			this.isConnecting = false;
			this.client = null; // Clear the reference
		}
	}

	/**
	 * Checks if the client is currently connected and ready.
	 * @returns boolean
	 */
	public isReady(): boolean {
		// Check both internal flag and client's state if available
		return this.isConnected && (this.client?.isReady ?? false);
	}

	/**
	 * Gets the underlying Redis client instance.
	 * Throws an error if the client is not connected/ready to prevent commands execution when disconnected.
	 * @returns The connected RedisClientType instance.
	 * @throws Error if the client is not connected or ready.
	 */
	public getClient(): RedisClientType {
		if (!this.isReady() || !this.client) {
			throw new Error('Redis client is not connected or ready. Cannot get client instance.');
		}
		return this.client;
	}

	/**
	 * Safely performs a PING command to check active connection.
	 * @returns {Promise<boolean>} True if PONG received, false otherwise.
	 */
	public async ping(): Promise<boolean> {
		if (!this.isReady() || !this.client) {
			return false;
		}
		try {
			const result = await this.client.ping();
			return result === 'PONG';
		} catch (error) {
			logger.warn(
				`Redis PING failed: ${error instanceof Error ? error.message : String(error)}`
			);
			// Consider updating isConnected status based on ping failure if needed
			// this.isConnected = false;
			return false;
		}
	}
}

// --- Export Singleton Instance ---
// This ensures only one RedisService instance manages the connection pool.
export const redisService = new RedisService();
