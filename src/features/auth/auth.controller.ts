// src/modules/auth/auth.controller.ts
import { Request, Response, NextFunction } from 'express';
import { StatusCodes } from 'http-status-codes';
import { authService } from './auth.service';
import { asyncWrapper } from '../../utils/asyncWrapper'; 
import { LoginInput, RegisterInput, ResendVerificationInput, RegisterCompanyInput } from './validate'; // Add Resend type
import {
	BadRequestError,
} from '../../utils/ApiError';



export const registerCompanyHandler = asyncWrapper(
    async (req: Request, res: Response, next: NextFunction) => {
        
        const registrationData: RegisterCompanyInput = req.body;

        const newUser = await authService.registerCompanyAndAdmin(registrationData);

        res.status(StatusCodes.CREATED).json({
            message: 'Company and admin account registered successfully. Please check your email to verify your account.',
            user: {
                id: newUser.id,
                email: newUser.email,
                companyId: newUser.companyId,
                role: newUser.role,
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
		next: NextFunction
	): Promise<void> => {
		
		const { email, password } = req.body as LoginInput;

		const { user, accessToken } = await authService.loginUser(email, password);

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