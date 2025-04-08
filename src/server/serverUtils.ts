import http from 'http';
import express from 'express';
import logger from '../config/logger';

/**
 * Creates an HTTP server instance with standardized error handling and logging.
 * @param app The Express application instance.
 * @param serverName A name for the server used in logging (e.g., 'Main', 'Admin').
 * @returns An http.Server instance.
 */
export function createServer(app: express.Application, serverName: string): http.Server {
	const server = http.createServer(app);

	server.on('error', (error: NodeJS.ErrnoException) => {
		// Ensure address info is available for logging, even if listen failed early
		const address = server.address();
		// Use a default port description if address isn't available yet
		const bind = address
			? typeof address === 'string'
				? `Pipe ${address}`
				: `Port ${address.port}`
			: `the configured port`; // Fallback description

		if (error.syscall !== 'listen') {
			logger.error(`${serverName} encountered an unexpected error:`, error);
			throw error; // Rethrow non-listen errors
		}

		// Handle specific listen errors:
		switch (error.code) {
			case 'EACCES':
				logger.error(
					`❌ ${serverName}: ${bind} requires elevated privileges. Permission denied.`
				);
				process.exit(1);
			// eslint-disable-next-line no-fallthrough -- Intentional fallthrough handled by process.exit
			case 'EADDRINUSE':
				logger.error(`❌ ${serverName}: ${bind} is already in use.`);
				process.exit(1);
			// eslint-disable-next-line no-fallthrough -- Intentional fallthrough handled by process.exit
			default:
				logger.error(
					`❌ ${serverName}: Failed to bind to ${bind}. Error code: ${error.code}`
				);
				throw error; // Rethrow other listen errors
		}
	});

	server.on('listening', () => {
		const addr = server.address();
		// Should always have an address object when 'listening' fires
		if (!addr) {
			logger.warn(`${serverName} is listening, but server address could not be determined.`);
			return;
		}
		const bind = typeof addr === 'string' ? `pipe ${addr}` : `port ${addr.port}`;
		logger.info(`${serverName} listening successfully on ${bind}`);
	});

	return server;
}
