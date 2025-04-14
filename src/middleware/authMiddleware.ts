import { Request, Response, NextFunction, RequestHandler } from 'express';
import * as jwt from 'jsonwebtoken';
import { User } from '@prisma/client';
import env from '../config/env';
import { userService } from '@/modules/user/user.service';
import { UnauthorizedError, ApiError } from '@/utils/ApiError';
import logger from '@/config/logger';


interface VerifiedJwtPayload {
    id: string;
    email: string;
    role: User['role'];
    companyId: string | null;
    isVerified: boolean; 
}


// Define the structure of the user object attached to the request
export interface AuthenticatedUser {
	id: string;
	email: string;
	role: User['role'];
	companyId: string | null;
	isVerified: boolean;
}

// Extend Express Request type using module augmentation or intersection
export interface AuthRequest extends Request {
	user: AuthenticatedUser;
}

/**
 * Middleware to authenticate requests using JWT.
 *
 * Responsibilities:
 * 1. Extracts JWT from Authorization header.
 * 2. Verifies JWT signature and expiration.
 * 3. Decodes payload.
 * 4. Validates required claims (userId).
 * 5. **Checks critical flags (e.g., isVerified) FROM THE TOKEN PAYLOAD.**
 * 6. Attaches authenticated user info (from token) to `req.user`.
 * 7. Handles JWT errors gracefully.
 * 8. Passes errors to the centralized error handler.
 * Status changes after issuance are only reflected upon token expiry/refresh.
 */
export const authMiddleware: RequestHandler = async (
	req, 
	res: Response,
	next: NextFunction
): Promise<void> => {
	const authReq = req as AuthRequest; // Keep cast for internal use
	try {
		const authHeader = req.header('Authorization');

		if (!authHeader || !authHeader.startsWith('Bearer ')) {
			throw new UnauthorizedError('Authentication token is required.');
		}
		const token = authHeader.substring(7);

		let payload: VerifiedJwtPayload;
		try {
			payload = jwt.verify(token, env.JWT_ACCESS_SECRET, {
				issuer: env.JWT_ISSUER,     
        		audience: env.JWT_AUDIENCE 
			}) as VerifiedJwtPayload;

			if (!payload || typeof payload !== 'object' || !payload.id) {
				logger.warn({ tokenPayload: payload }, 'JWT verification succeeded but payload is invalid or missing userId');
				// Use return next() for consistency
				return next(new UnauthorizedError('Invalid token payload.'));
		   }
		} catch (error) {
			if (error instanceof jwt.TokenExpiredError) {
                logger.debug({ error: error.message }, 'Authentication failed: Token expired');
                return next(new UnauthorizedError('Token expired. Please log in again.'));
            }
            if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.NotBeforeError) {
                logger.warn({ error: error.message }, `Authentication failed: ${error.message}`);
                return next(new UnauthorizedError('Invalid token.'));
            }
            // Handle unexpected verification errors
            logger.error({ error }, 'Unexpected error during JWT verification');
             // Rethrow to be caught by the outer catch block
            throw error;
		}

		if (!payload.isVerified) {
            logger.warn({ userId: payload.id }, 'Authentication failed: User is not verified (based on token claim)');
            return next(new UnauthorizedError('User account is not verified.'));
        }

		// Attach authenticated user information
		authReq.user = {
			id: payload.id,
			email: payload.email,
			role: payload.role,
			companyId: payload.companyId,
			isVerified: payload.isVerified,
		};

		logger.debug({ userId: authReq.user.id }, 'User authenticated successfully via JWT');
        next();
	} catch (error) {
		if (error instanceof ApiError) {
             next(error);
        } else {
            logger.error({ error }, 'Unexpected error in authMiddleware');
            next(new ApiError(500, 'An internal error occurred during authentication.'));
        }
	}
};

// Role based authorize middleware
export const authorize = (allowedRoles: User['role'][]): RequestHandler => {
	return (req: Request, res: Response, next: NextFunction) => {
		const authReq = req as AuthRequest;
		const user = authReq.user;

		if (!user) {
			logger.warn('Authorization failed: User information is missing from the request.');
			return next(new UnauthorizedError('User authentication required.'));
		}

		if (!allowedRoles.includes(user.role)) {
			logger.warn({ userId: user.id, userRole: user.role }, 'Authorization failed: User does not have the required role.');
			return next(new ApiError(403, 'Forbidden: You do not have permission to access this resource.'));
		}

		next();
	};
}
