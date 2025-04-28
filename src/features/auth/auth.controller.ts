// src/modules/auth/auth.controller.ts
import { Request, Response, NextFunction } from 'express';
import { StatusCodes } from 'http-status-codes';
import { authService } from './auth.service';
import { asyncWrapper } from '../../utils/asyncWrapper'; 
import { LoginInput, RegisterInput, ResendVerificationInput, RegisterCompanyInput } from './validate'; // Add Resend type
import {
	BadRequestError,
} from '../../utils/ApiError';
import { AuthRequest } from '../../middleware/authMiddleware';
import { authUtils } from '../../utils/auth.utils';
import logger from '../../config/logger';
import jwt from 'jsonwebtoken';



export const registerCompanyHandler = asyncWrapper(
    async (req: Request, res: Response, next: NextFunction) => {
        
        const registrationData: RegisterCompanyInput = req.body;

        const newUser = await authService.registerCompanyAndAdmin(registrationData);

        res.status(StatusCodes.CREATED).json({
            message: 'Company and admin account registered successfully. Please check your email to verify your account.',
            user: {
                id: newUser.id,
                email: newUser.email,
            },
        });
    }
);

/**
 * Handles user registration requests.
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Express next function for error handling
 */
export const registerHandler = asyncWrapper(
	async (
		req: Request,
		res: Response,
		next: NextFunction
	): Promise<void> => {
		
		const registerData = req.body as RegisterInput;
		const user = await authService.registerUser(registerData); // This now triggers email sending

		// Indicate success and that verification is needed
		res.status(StatusCodes.CREATED).json({
			success: true,
			// Modify message to inform user about verification step
			message: 'Registration successful. Please check your email to verify your account.',
			data: user, // Return safe user data (now includes isVerified: false)
		});
		
	}
);


/**
 * Handles user login requests.
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Express next function for error handling
 */
export const loginHandler = asyncWrapper(
	async (
		req: Request,
		res: Response,
	)=> {
		
		const { email, password, companyId } = req.body 

		const data = {
			email, password, companyId
		} as LoginInput;

		const { user, accessToken } = await authService.loginUser(data);

		res.status(StatusCodes.OK).json({
			success: true,
			message: 'Login successful.',
			data: {
				accessToken,
				user,
			},
		});
		
	}
)


/**
 * Handles email verification requests using the token from URL params.
 */
export const verifyEmailHandler = asyncWrapper(
	async (
		req: Request,
		res: Response,
		next: NextFunction
	): Promise<void> => {
		
		const { token } = req.query as { token: string };
		if (!token) {
			throw new BadRequestError('Verification token is missing.');
		}

		// Service function handles token verification and user update
		await authService.verifyEmailTokenAndVerifyUser(token);

		res.status(StatusCodes.OK).json({
			success: true,
			message: 'Email verified successfully, Login',
		});
		
	}
)


/**
 * Handles requests to resend the verification email.
 */
export const resendVerificationHandler = asyncWrapper(
	async (
		req: Request,
		res: Response,
		next: NextFunction
	): Promise<void> => {
	
		const { email } = req.body as ResendVerificationInput;

		const user = await authService.resendVerificationEmail(email);

		res.status(StatusCodes.OK).json({
			success: true,
			message:
				'If an account with this email exists and is not verified, a new verification link has been sent.',
		});
	}
)


export const refreshTokenHandlerController = asyncWrapper(
	async (
		req: Request,
		res: Response
	) => {
		const { refreshToken, companyId } = req.body;

		if (!refreshToken) {
			throw new BadRequestError('Refresh token is required.');
		}

		const { user, accessToken, newRefreshToken } = await authService.refreshTokenHandler(refreshToken, companyId);

		res.status(StatusCodes.OK).json({
			success: true,
			message: 'Access token refreshed successfully.',
			data: {
				accessToken,
				refreshToken: newRefreshToken,
			},
		});
	}
)



// --- Logout Endpoint Handler ---
/**
 * Handles user logout by revoking the refresh token.
 * This would be a separate API endpoint (e.g., POST /auth/logout).
 */
export const logoutHandler = asyncWrapper(async (req: AuthRequest, res) => {
	const refreshToken = req.body.refreshToken as string | undefined; 

	const authHeader = req.header('Authorization');
    const accessToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;

	if (!refreshToken) {
		if (!accessToken) {
			const decoded = jwt.decode(accessToken) as jwt.JwtPayload;
			if (decoded && decoded.exp) {
				const now = Math.floor(Date.now() / 1000);
				const remainingExpiry = decoded.exp - now;
				if (remainingExpiry > 0) {
					await authUtils.addAccessTokenToRevocationList(accessToken, remainingExpiry);
					logger.info( 'User logged out successfully (access token invalidated)');
					return res.status(StatusCodes.OK).json({ message: 'Logged out successfully.' });
				} else {
					logger.debug('Logout request with expired access token (no refresh token).');
                         return res.status(StatusCodes.OK).json({ message: 'Logged out successfully (access token already expired).' });
				}

			} else {
				logger.warn({ userId: req.user?.id }, 'Logout request with invalid access token format (no refresh token).');
                return res.status(StatusCodes.OK).json({ message: 'Logout attempt processed.' });
			}
		} else {
			logger.warn({ userId: req.user?.id }, 'Logout request received without tokens.');
             return res.status(StatusCodes.BAD_REQUEST).json({ message: 'Logout requires either a refresh token or an access token.' });
		}
	}

	const isRevoked = await authUtils.isRefreshTokenRevoked(refreshToken);
	if (isRevoked) {
		logger.warn({ userId: req.user?.id, refreshToken }, 'Logout request with revoked refresh token.');
		return res.status(StatusCodes.OK).json({ message: 'Logged out successfully (refresh token already revoked).' });
	}

	const revokedCount = await authUtils.revokeRefreshToken(refreshToken);
	if (revokedCount === 0) {
		// This might happen if the token was already expired in Redis but not explicitly revoked
		logger.warn({ refreshToken, userId: req.user?.id }, 'Logout: Refresh token not found in Redis (possibly already expired).');
		// Still proceed to invalidate access token if present
   } else {
		logger.info({ userId: req.user?.id, refreshToken }, 'Refresh token revoked on logout');
   }

   	if (accessToken) {
		const decoded = jwt.decode(accessToken) as jwt.JwtPayload;
		if (decoded && decoded.exp) {
			const now = Math.floor(Date.now() / 1000);
			const remainingExpiry = decoded.exp - now;
			if (remainingExpiry > 0) {
			   await authUtils.addAccessTokenToRevocationList(accessToken, remainingExpiry);
				logger.debug({ userId: req.user?.id }, 'Access token added to revocation list on logout.');
			}
		}
	}

	logger.info({ userId: req.user?.id }, 'User logged out successfully.');
	res.status(StatusCodes.OK).json({ message: 'Logged out successfully.' });
});
