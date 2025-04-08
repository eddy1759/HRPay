import { PrismaClient } from '@prisma/client';
import logger from '../config/logger';
import env from '../config/env';
import { InternalServerError } from '../utils/ApiError';

const prismaInstance = new PrismaClient({
	log: ['query', 'info', 'warn', 'error'],
	datasources: {
		db: {
			url: env.DATABASE_URL,
		},
	},
});

function exponentialBackoff(
	attempt: number,
	baseDelay: number = 1000,
	maxDelay: number = 30000
): number {
	// Calculate the exponential delay: baseDelay * 2^attempt
	const delay = baseDelay * Math.pow(2, attempt);

	// Add some randomness to avoid synchronized retries
	const jitter = Math.random() * 1000;

	// Ensure the delay doesn't exceed the maximum delay
	return Math.min(delay + jitter, maxDelay);
}

export const prisma = new PrismaClient();

export async function connectToDatabase(maxRetries = 5) {
	for (let i = 0; i < maxRetries; i++) {
		try {
			logger.info('Attempting to connect to database...');
			await prismaInstance.$connect();
			logger.info('Connected to database successfully');

			return prismaInstance;
		} catch (error) {
			logger.error(`Failed to connect to database (attempt ${i + 1}/${maxRetries}):`, error);
			if (i < maxRetries - 1) {
				const delay = exponentialBackoff(i);
				logger.info(`Retrying in ${delay}ms...`);
				await new Promise((resolve) => setTimeout(resolve, delay));
			}
		}
	}
	throw new InternalServerError('Failed to connect to database after multiple attempts');
}

export async function disconnectFromDatabase() {
	try {
		await prismaInstance.$disconnect();
		logger.info('Disconnected from database');
	} catch (error) {
		logger.error('Error disconnecting from database:', error);
	}
}

export function dBisConnected(): boolean {
	try {
		return prismaInstance.$connect !== undefined;
	} catch (error) {
		logger.error('Database connection check failed:', error);
		return false;
	}
}
