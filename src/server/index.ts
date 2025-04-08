import { startServer } from './startup';
import logger from '../config/logger';

process.on('uncaughtException', (error: Error) => {
	logger.fatal('UNCAUGHT EXCEPTION! Shutting down...', error);
	process.exit(1); // Mandatory exit
});

process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
	logger.fatal('UNHANDLED REJECTION! Shutting down...', { reason, promise });
	process.exit(1); // Mandatory exit
});

startServer();
