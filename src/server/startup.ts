import http from 'http'; // Added import for http.Server type hint
import app from '../index';
import logger from '../config/logger';
import env from '../config/env';
import { createServer } from './serverUtils';
import { amqpWrapper } from '../lib/amqplib';
import { redisService } from '../lib/redis';
import { connectToDatabase, dBisConnected, disconnectFromDatabase } from '../lib/prisma';

// import { startBackgroundProcesses } from '../consumer/index'; // Assuming correct export path
import { setupGracefulShutdown } from './shutdown'; // Assuming correct export path

const isProduction = env.NODE_ENV === 'production';

/**
 * Initializes services, starts the main HTTP server, and sets up graceful shutdown.
 */
export async function startServer(): Promise<void> {
	// Return void or the server instance if needed elsewhere
	const mainServer = createServer(app, 'Main');

	try {
		logger.info('--- Starting Server Initialization ---');
		await redisService.connect();
		await amqpWrapper.initialize();
		await connectToDatabase(); // Throws on failure

		// // 3. Start background processes/consumers
		// logger.info('Starting background processes...');
		// await startBackgroundProcesses(); // Assuming async start
		// logger.info('Background processes started.');

		// 4. Start the HTTP Server
		const mainPort = process.env.PORT || env.PORT; // process.env.PORT takes precedence in production or any environment where it's set

		await new Promise<void>((resolve, reject) => {
			mainServer
				.listen(mainPort, () => {
					// Listening log message is handled by createServer's 'listening' event handler
					resolve();
				})
				.on('error', (error) => {
					// Error handling (EADDRINUSE, EACCES) is handled by createServer's 'error' handler
					// Reject here to propagate other unexpected listen errors
					reject(error);
				});
		});

		logger.info(`Server ready at http://localhost:${mainPort} in ${env.NODE_ENV} mode`);

		setupGracefulShutdown([mainServer] /*, potentially add disconnect functions here */);
		logger.info('Graceful shutdown configured.');

		logger.info('--- Server Initialization Complete ---');
	} catch (error) {
		logger.error('💥 Server startup failed:', error);
		// Perform any emergency cleanup if necessary (e.g., disconnect already connected services)
		await Promise.allSettled([
			redisService.disconnect(),
			amqpWrapper.close(),
			disconnectFromDatabase(),
		]);
		process.exit(1); // Exit forcefully on critical startup failure
		// throw error; // Re-throwing might be less desirable than exiting for startup errors
	}
}

/**
 * Checks the readiness of critical external services.
 * Suitable for /healthz or /readyz endpoints.
 */
export async function checkServerReadiness() {
	const checks = [
		{ name: 'Redis Ping', check: () => redisService.ping() }, // Assuming isConnected is sync
		{ name: 'AMQP', check: () => Promise.resolve(amqpWrapper.isConnected()) }, // Assuming isConnected is sync
		{ name: 'Database', check: () => dBisConnected() }, // <-- Use the new async function
		// Add other critical checks (e.g., storage service ping) if applicable
	];

	// Use Promise.allSettled to get results even if some checks fail
	const settledResults = await Promise.allSettled(
		checks.map(async (service) => {
			const isReady = await service.check();
			if (!isReady) {
				// Throw an error specifically for Promise.allSettled to catch in 'rejected' state
				throw new Error(`${service.name} is not ready`);
			}
			return { service: service.name, status: 'READY' as const }; // Use 'as const' for stricter typing
		})
	);

	const results = settledResults.map((result, index) => {
		const serviceName = checks[index].name;
		if (result.status === 'fulfilled') {
			return { service: serviceName, status: 'READY' as const };
		} else {
			// Log the specific error for better debugging
			logger.warn(`Readiness check failed for ${serviceName}: ${result.reason.message}`);
			return {
				service: serviceName,
				status: 'NOT_READY' as const, // Changed from 'ERROR' to 'NOT_READY' for clarity
				error: result.reason.message, // Access error message from reason
			};
		}
	});

	const overallStatus = results.every((r) => r.status === 'READY') ? 'READY' : 'NOT_READY';

	if (overallStatus !== 'READY') {
		logger.warn('Server readiness check failed for one or more services.', {
			details: results,
		});
	}

	return {
		overall: overallStatus,
		services: results,
	};
}
