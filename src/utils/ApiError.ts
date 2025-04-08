import { StatusCodes } from 'http-status-codes';

/**
 * * Custom error class for API errors.
 * * This class extends the built-in Error class and adds additional properties
 */
export class ApiError extends Error {
	public readonly statusCode: number;
	public readonly isOperational: boolean;

	constructor(statusCode: number, message: string, isOperational = true, stack = '') {
		super(message);
		this.statusCode = statusCode;
		this.isOperational = isOperational; //Distinguish operational errors from programming errors
		if (stack) {
			this.stack = stack;
		} else {
			Error.captureStackTrace(this, this.constructor);
		}
		this.name = this.constructor.name;
	}
}

// Convenience classes for common errors

export class BadRequestError extends ApiError {
	constructor(message: string) {
		super(StatusCodes.BAD_REQUEST, message);
	}
}

export class UnauthorizedError extends ApiError {
	constructor(message: string) {
		super(StatusCodes.UNAUTHORIZED, message);
	}
}
export class ForbiddenError extends ApiError {
	constructor(message: string) {
		super(StatusCodes.FORBIDDEN, message);
	}
}
export class NotFoundError extends ApiError {
	constructor(message: string) {
		super(StatusCodes.NOT_FOUND, message);
	}
}

export class ConflictError extends ApiError {
	constructor(message: string) {
		super(StatusCodes.CONFLICT, message);
	}
}
export class InternalServerError extends ApiError {
	constructor(message: string) {
		super(StatusCodes.INTERNAL_SERVER_ERROR, message);
	}
}
export class ServiceUnavailableError extends ApiError {
	constructor(message: string) {
		super(StatusCodes.SERVICE_UNAVAILABLE, message);
	}
}
