import { Request, Response, NextFunction, RequestHandler } from 'express';
import * as jwt from 'jsonwebtoken';
import { User, SystemUserRole, EmployeeUserRole } from '@prisma/client';
import env from '../config/env';
import { authUtils } from '@/utils/auth.utils';
import { userService } from '@/features/user/user.service';
import { UnauthorizedError, ApiError, NotFoundError, ForbiddenError } from '@/utils/ApiError';
import logger from '@/config/logger';
import { prisma } from '@/lib/prisma';

interface VerifiedJwtPayload {
	id: string;
	email: string;
	systemRole: SystemUserRole;
	employeeRole: EmployeeUserRole | null;
	companyId: string | null;
	isVerified: boolean;
}

// Define the structure of the user object attached to the request
export interface AuthenticatedUser {
	id: string;
	email: string;
	systemRole: SystemUserRole;
    companyId: string | null;
    employeeRole: EmployeeUserRole | null;
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
				audience: env.JWT_AUDIENCE,
			}) as VerifiedJwtPayload;

			if (!payload || typeof payload !== 'object' || !payload.id) {
				logger.warn(
					{ tokenPayload: payload },
					'JWT verification succeeded but payload is invalid or missing userId'
				);
				// Use return next() for consistency
				return next(new UnauthorizedError('Invalid token payload.'));
			}

			const isRevoked = await authUtils.isAccessTokenRevoked(token);
            if (isRevoked) {
                 logger.warn({ userId: payload.id }, 'Authentication failed: Access token has been revoked.');
                 return next(new UnauthorizedError('Token has been revoked. Please log in again.'));
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
			logger.warn(
				{ userId: payload.id },
				'Authentication failed: User is not verified (based on token claim)'
			);
			return next(new UnauthorizedError('User account is not verified.'));
		}

		const latestUser = await userService.findUserByIdInternal(payload.id);
        if (!latestUser) {
            logger.warn({ userId: payload.id }, 'Authentication failed: Not Found.');
            return next(new NotFoundError('Not Found'));
        }
        const latestEmployee = await prisma.employee.findFirst({ where: { userId: payload.id, companyId: payload.companyId } });
        if (!latestEmployee || !latestEmployee.isActive || latestEmployee.isDeleted) {
             logger.warn({ userId: payload.id, companyId: payload.companyId }, 'Authentication failed: Employee record is inactive or deleted.');
             return next(new UnauthorizedError('Employee record is inactive or deleted.'));
        }

		// Attach authenticated user information
		authReq.user = {
			id: payload.id,
			email: payload.email,
			systemRole: latestUser.systemRole,
			companyId: latestEmployee.companyId,
			employeeRole: latestEmployee.role,
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




// --- Role based authorize middleware (Refactored) ---
/**
 * Middleware to authorize requests based on user's system role or employee role.
 * Can optionally enforce authorization within a specific company context.
 *
 * @param params - Authorization parameters.
 * @param params.allowedSystemRoles - Array of allowed system roles.
 * @param params.allowedEmployeeRoles - Array of allowed employee roles.
 * @param [params.requireCompanyMatch=false] - If true, requires the user's companyId from the token to match the companyId in the request (e.g., from route params).
 * @param [params.getCompanyIdFromRequest] - A function to extract the companyId from the request object if requireCompanyMatch is true.
 */
export const authorize = (params: {
    allowedSystemRoles?: SystemUserRole[];
    allowedEmployeeRoles?: EmployeeUserRole[];
    requireCompanyMatch?: boolean;
    getCompanyIdFromRequest?: (req: Request) => string | undefined; // Function to get companyId from request
}): RequestHandler => {
    return (req: Request, res: Response, next: NextFunction) => {
        const authReq = req as AuthRequest;
        const user = authReq.user;

        if (!user) {
            logger.warn('Authorization failed: User information is missing from the request.');
            return next(new UnauthorizedError('User authentication required.'));
        }

        const { allowedSystemRoles, allowedEmployeeRoles, requireCompanyMatch = false, getCompanyIdFromRequest } = params;

        let isAuthorizedByRole = false;

        // Check System Role
        if (allowedSystemRoles && allowedSystemRoles.length > 0) {
            if (user.systemRole && allowedSystemRoles.includes(user.systemRole)) {
                isAuthorizedByRole = true;
            }
        }

        // Check Employee Role (only if not already authorized by system role)
        if (!isAuthorizedByRole && allowedEmployeeRoles && allowedEmployeeRoles.length > 0) {
             if (user.employeeRole && allowedEmployeeRoles.includes(user.employeeRole)) {
                 isAuthorizedByRole = true;
             }
         }


        if (!isAuthorizedByRole) {
            logger.warn(
                { userId: user.id, systemRole: user.systemRole, employeeRole: user.employeeRole },
                'Authorization failed: User does not have the required system or employee role.'
            );
             return next(
                 new ApiError(403, 'Forbidden: You do not have the required role to access this resource.')
             );
        }

        // --- Optional: Check Company Match ---
        if (requireCompanyMatch) {
            if (!getCompanyIdFromRequest) {
                 logger.error('Authorization configuration error: requireCompanyMatch is true but getCompanyIdFromRequest is not provided.');
                 // Fail securely if configuration is incorrect
                 return next(new ApiError(500, 'Internal authorization configuration error.'));
            }

            const requestedCompanyId = getCompanyIdFromRequest(req);

            if (!requestedCompanyId) {
                 logger.warn({ userId: user.id }, 'Authorization failed: Company ID missing from request for company-specific check.');
                 return next(new ApiError(400, 'Company context is required for this operation.'));
            }

            // Check if the user's companyId from the token matches the requested companyId
            if (!user.companyId || user.companyId !== requestedCompanyId) {
                 logger.warn(
                     { userId: user.id, userCompanyId: user.companyId, requestedCompanyId },
                     'Authorization failed: User\'s company ID does not match the requested company ID.'
                 );
                 return next(
                     new ForbiddenError('Forbidden: You do not have access to resources in this company context.')
                 );
            }

             logger.debug({ userId: user.id, companyId: user.companyId }, 'Company match successful for authorization.');
        }


        // If we reached here, the user is authorized by role and optionally by company context
        logger.debug({ userId: user.id }, 'Authorization successful.');
        next();
    };
};
