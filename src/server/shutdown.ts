import http from 'http';
import logger from '../config/logger';
import { amqpWrapper } from '../lib/amqplib';
import { redisService } from '../lib/redis';
import { disconnectFromDatabase } from '../lib/prisma';

export function setupGracefulShutdown(servers: http.Server[]) {
	['SIGTERM', 'SIGINT', 'SIGUSR2'].forEach((signal) =>
		process.on(signal, () => gracefulShutdown(servers))
	);
}

async function gracefulShutdown(servers: http.Server[]) {
	logger.info('--- Starting Graceful Shutdown ---');
	try {
		await Promise.all(
			servers.map(
				(server) =>
					new Promise<void>((resolve, reject) => {
						server.close((err) => {
							if (err) reject(err);
							else resolve();
						});
					})
			)
		);
		await redisService.disconnect();
		await amqpWrapper.close();
		await disconnectFromDatabase();
		logger.info('All servers and connections closed');
		process.exit(0);
	} catch (err) {
		logger.error('Error during graceful shutdown:', err);
		process.exit(1);
	}
}
