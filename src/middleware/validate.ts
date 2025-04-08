import { Request, Response, NextFunction } from 'express';
import { AnyZodObject, ZodError } from 'zod';
import { StatusCodes } from 'http-status-codes';
import { ApiError } from '../utils/ApiError'; // Adjust path if needed

/**
 * Middleware factory to validate request data against a Zod schema.
 * Validates req.body, req.query, and req.params based on the provided schema.
 * Passes ZodError to the centralized error handler on failure.
 */
export const validate =
	(schema: AnyZodObject) =>
	async (req: Request, res: Response, next: NextFunction): Promise<void> => {
		try {
			// Parse and validate the request parts defined in the schema
			await schema.parseAsync({
				body: req.body,
				query: req.query,
				params: req.params,
			});
			// If validation succeeds, proceed to the next middleware/handler
			return next();
		} catch (error) {
			// If validation fails, Zod throws a ZodError
			// Pass it to the centralized error handler
			if (error instanceof ZodError) {
				// Let the centralized handler format this ZodError
				return next(error);
			}
			// Handle unexpected errors during validation
			return next(
				new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'Error during request validation.')
			);
		}
	};
