import bcrypt from 'bcrypt';
import { Request } from 'express';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { User, UserRole } from '@prisma/client';
import logger from '../config/logger';
import env from '../config/env';
import { BadRequestError, InternalServerError, UnauthorizedError } from '../utils/ApiError';
import { AuthenticatedUser, AuthRequest } from '../middleware/authMiddleware';


interface AccessTokenPayload extends jwt.JwtPayload {
    id: string; // Changed from userId to id (matches User model, common practice like 'sub')
    email: string;
    role: UserRole;
    companyId: string | null;
    isVerified: boolean;
}

interface EmailVerificationTokenPayload extends jwt.JwtPayload {
	id: string; // User ID to verify
	email: string; // User email for confirmation
}


export const getAuthenticatedUser = (req: Request): AuthenticatedUser => {
	const user = (req as AuthRequest).user;
	if (!user) {
		 throw new UnauthorizedError('Authentication required.');
	}
	return user;
};


/**
 * @description - Hashes a password using bcrypt
 * @param {string} password
 * @return {string} {Promise<string>}
 */
const hashPassword = async (password: string): Promise<string> => {
	const salt = await bcrypt.genSalt(env.SALT_ROUNDS);
	return bcrypt.hash(password, salt);
};

/**
 * @description - Compares a plain text password with a hashed password
 * @param {string} password
 * @param {string} hashPassword
 * @return {boolean} {Promise<boolean>}
 */
const verifyPassword = async (plainPassword: string, hashedPassword?: string): Promise<boolean> => {
	if (!hashedPassword) return false;
	return bcrypt.compare(plainPassword, hashedPassword);
};

/**
 * @description - Generates a JWT token
 * @param {User} user
 * @return {string} {Promise<string>}
 */

export const generateAccessToken = (user: Pick<User, 'id' | 'role' |  'email' | 'isVerified' | 'companyId'>): string => {
    
    const payload: AccessTokenPayload = {
        id: user.id,
        role: user.role,
		email: user.email,
		isVerified: user.isVerified,
		companyId: user.companyId ?? null,
    };


    return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
        expiresIn: env.JWT_EXPIRES_IN,
        algorithm: 'HS256', 
        issuer: env.JWT_ISSUER,
        audience: env.JWT_AUDIENCE,
    } as jwt.SignOptions);
};

/**
 * Generates a JWT token specifically for email verification.
 */
const generateEmailVerificationToken = (userId: string, email:string): string => {
	const payload: EmailVerificationTokenPayload = { id: userId, email };

	const token = jwt.sign(payload, env.JWT_VERIFICATION_SECRET, {
		expiresIn: env.JWT_VERIFICATION_EXPIRY,
		algorithm: 'HS256',
		issuer: env.JWT_ISSUER,
		audience: env.JWT_AUDIENCE,
	} as jwt.SignOptions);
	return token;
};


/**
 * Verifies a standard JWT access token.
 * @throws UnauthorizedError for invalid/expired tokens or payload issues.
 * @throws InternalServerError for unexpected errors.
 */
const verifyAccessToken = (token: string): AccessTokenPayload => {
	if (!token) {
		throw new Error('Token is required');
	}

	try {
		const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, {
			issuer: env.JWT_ISSUER,
			audience: env.JWT_AUDIENCE,
		});

		if (typeof decoded !== 'object' || decoded === null || typeof decoded.id !== 'string') {
			logger.warn('Invalid access token payload structure after verification.', { decoded });
		   throw new UnauthorizedError('Invalid token payload.');
	   }

		return decoded as AccessTokenPayload;
	} catch (error) {
		if (error instanceof jwt.JsonWebTokenError) {
			logger.error('Invalid access token:', error.message);
			throw new BadRequestError('Invalid token');
		}

		if (error instanceof jwt.TokenExpiredError) {
			logger.error('Access token expired:', error.message);
			throw new BadRequestError('Token expired');
		}

		logger.error('Failed to verify token:', error);
		throw new InternalServerError('Failed to verify token');
	}
};

/**
 * Verifies an email verification token.
 * @throws BadRequestError for missing token.
 * @throws UnauthorizedError for invalid/expired tokens or payload issues.
 * @throws InternalServerError for unexpected errors.
 */
const verifyEmailVerficiationToken = (token: string): EmailVerificationTokenPayload => {
	if (!token) {
		throw new BadRequestError('Token is required');
	}

	try {
		const decoded = jwt.verify(token, env.JWT_VERIFICATION_SECRET, {
			issuer: env.JWT_ISSUER,
			audience: env.JWT_AUDIENCE,
		});


		if (typeof decoded !== 'object' || decoded === null || typeof decoded.id !== 'string' || typeof decoded.email !== 'string') {
			logger.warn('Invalid email verification token payload structure.', { decoded });
		   throw new UnauthorizedError('Invalid verification token payload.');
	   }

		return decoded as EmailVerificationTokenPayload;
	} catch (error) {
		if (error instanceof jwt.JsonWebTokenError) {
			logger.error('Invalid email verification token:', error.message);
			throw new BadRequestError('Invalid verification token.');
		}

		if (error instanceof jwt.TokenExpiredError) {
			logger.error('Email verification token expired:', error.message);
			throw new BadRequestError('Token expired');
		}

		logger.error('Failed to verify email verification token:', error);
		throw new InternalServerError('Failed to verify token');
	}
};

export const authUtils = {
	hashPassword,
	verifyPassword,
	generateAccessToken,
	verifyAccessToken,
	generateEmailVerificationToken,
	verifyEmailVerficiationToken,
};
