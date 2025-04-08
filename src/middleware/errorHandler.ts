import { Request, Response, NextFunction } from 'express';
import { StatusCodes } from 'http-status-codes';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import * as jwt from 'jsonwebtoken';
import { ApiError } from '../utils/ApiError';
import logger from '../config/logger';
import env from '../config/env';

const handleZodError = (err: ZodError): ApiError => {
	const errors = err.errors.map((e) => `${e.path.join('.')} - ${e.message}`).join(', ');
	return new ApiError(StatusCodes.BAD_REQUEST, `Input validation failed: ${errors}`);
};

const handleJwtError = (err: jwt.JsonWebTokenError): ApiError => {
	return new ApiError(
		StatusCodes.UNAUTHORIZED,
		err instanceof jwt.TokenExpiredError
			? 'Token expired. Please log in again.'
			: 'Invalid token. Please log in again.'
	);
};

const handlePrismaError = (err: Prisma.PrismaClientKnownRequestError): ApiError => {
	let statusCode = StatusCodes.INTERNAL_SERVER_ERROR;
	let message = 'An unexpected database error occurred.';

	switch (err.code) {
		case 'P2002': // Unique constraint violation
			const field = err.meta?.target ? (err.meta.target as string[]).join(', ') : 'field';
			message = `The provided ${field} is already in use.`;
			statusCode = StatusCodes.CONFLICT;
			break;
		case 'P2025': // Record to update/delete not found
			message = 'The requested resource was not found.';
			statusCode = StatusCodes.NOT_FOUND;
			break;
		default:
			logger.error(`Unhandled Prisma Error: Code ${err.code}, Message: ${err.message}`);
	}

	return new ApiError(statusCode, message, true);
};

export const errorHandler = (err: Error, req: Request, res: Response, next: NextFunction) => {
	logger.error({ message: err.message, stack: err.stack }); // Log original error

	let error: ApiError;

	if (err instanceof ZodError) {
		error = handleZodError(err);
	} else if (err instanceof jwt.JsonWebTokenError) {
		error = handleJwtError(err);
	} else if (err instanceof Prisma.PrismaClientKnownRequestError) {
		error = handlePrismaError(err);
	} else if (err instanceof ApiError) {
		error = err;
	} else {
		error = new ApiError(
			StatusCodes.INTERNAL_SERVER_ERROR,
			'An internal server error occurred.',
			false,
			err.stack
		);
	}

	// Send error response
	res.status(error.statusCode).json({
		success: false,
		message: error.message,
		...(env.NODE_ENV === 'development' && { stack: error.stack }),
	});

	// Handle non-operational errors (e.g., programming bugs)
	if (!error.isOperational && env.NODE_ENV !== 'development') {
		logger.fatal('Non-operational error detected, shutting down...');
		process.emit('uncaughtException', err); // Emit event instead of force exit
	}
};
