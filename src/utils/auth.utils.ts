import bcrypt from 'bcrypt';
import { Request } from 'express';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { User, EmployeeUserRole, SystemUserRole } from '@prisma/client';
import logger from '../config/logger';
import env from '../config/env';
import { BadRequestError, InternalServerError, UnauthorizedError } from '../utils/ApiError';
import { AuthenticatedUser, AuthRequest } from '../middleware/authMiddleware';
import { redisService } from '../lib/redis';


interface AccessTokenPayload extends jwt.JwtPayload {
   	id: string;
	email: string;
	systemRole: SystemUserRole;
	employeeRole: EmployeeUserRole | null;
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

export const generateAccessToken = (
	user: User,
	companyId: string | null,
	employeeRole: EmployeeUserRole | null,
	isVerified: boolean
): string => {
    
    const payload: AccessTokenPayload = {
        id: user.id,
		email: user.email,
		systemRole: user.systemRole,
        companyId,
        employeeRole,
        isVerified
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
 * Generates a new refresh token.
 * Refresh tokens are typically simple strings or UUIDs, not JWTs,
 * and are stored server-side (in Redis).
 *
 * @returns The generated refresh token string.
 */
const generateRefreshToken = (): string => {
	return require('uuid').v4();
}


/**
 * Stores a refresh token in Redis associated with a user ID.
 *
 * @param userId - The ID of the user.
 * @param refreshToken - The refresh token string.
 * @returns A promise that resolves when the token is stored.
 */
const storeRefreshToken =  async (userId: string, refreshToken: string): Promise<void> => {
	const key = `${env.REFRESH_TOKEN_REDIS_PREFIX}${refreshToken}`;
	await redisService.set(key, userId, env.REFRESH_TOKEN_EXPIRY_SECONDS);
	logger.debug({ userId, refreshToken }, 'Refresh token stored in Redis');
}

/**
 * Retrieves the user ID associated with a refresh token from Redis.
 *
 * @param refreshToken - The refresh token string.
 * @returns A promise resolving to the user ID if found, or null if not found or expired.
 */
const getUserIdFromRefreshToken =  async (refreshToken: string): Promise<string | null> => {
	const key = `${env.REFRESH_TOKEN_REDIS_PREFIX}${refreshToken}`;
	const userId = await redisService.get(key);

	logger.debug({ refreshToken, userId }, 'Attempted to retrieve user ID from refresh token in Redis');
	return userId;
}


/**
 * Revokes a refresh token by deleting it from Redis.
 *
 * @param refreshToken - The refresh token string to revoke.
 * @returns A promise resolving to the number of keys deleted.
 */
const revokeRefreshToken = async (refreshToken: string): Promise<number> => {
	const key = `${env.REFRESH_TOKEN_REDIS_PREFIX}${refreshToken}`;
	const deletedCount = await redisService.del(key);

	logger.debug({ refreshToken, deletedCount }, 'Refresh token revoked in Redis');
	return deletedCount;
}


 /**
 * Adds an access token to a revocation list in Redis.
 * This is useful for immediate revocation before the token naturally expires.
 * The token is stored with its remaining time-to-live (TTL).
 *
 * @param accessToken - The access token string to revoke.
 * @param expirySeconds - The remaining expiry time of the token in seconds.
 * @returns A promise that resolves when the token is added to the revocation list.
 */
 const addAccessTokenToRevocationList =  async (accessToken: string, expirySeconds: number): Promise<void> => {
	const key = `${env.REVOKED_ACCESS_TOKEN_REDIS_PREFIX}${accessToken}`;
	await redisService.set(key, 'revoked', expirySeconds);
	logger.debug({ accessToken, expirySeconds }, 'Access token added to revocation list in Redis');
}


/**
 * Checks if an access token is present in the revocation list in Redis.
 *
 * @param accessToken - The access token string to check.
 * @returns A promise resolving to true if the token is revoked, false otherwise.
 */
const isAccessTokenRevoked =  async (accessToken: string): Promise<boolean> => {
	const key = `${env.REVOKED_ACCESS_TOKEN_REDIS_PREFIX}${accessToken}`;
	const isRevoked = await redisService.getClient().exists(key);
	logger.debug({ accessToken, isRevoked: isRevoked > 0 }, 'Checking if access token is revoked in Redis');
	return isRevoked > 0;
}


/**
 * Adds a refresh token to a revocation list in Redis.
 * This is for revoking refresh tokens explicitly, e.g., on logout from all devices.
 *
 * @param refreshToken - The refresh token string to revoke.
 * @param expirySeconds - The remaining expiry time of the token in seconds.
 * @returns A promise that resolves when the token is added to the revocation list.
 */
const addRefreshTokenToRevocationList =  async (refreshToken: string, expirySeconds: number): Promise<void> => {
	const key = `${env.REVOKED_REFRESH_TOKEN_REDIS_PREFIX}${refreshToken}`;
	await redisService.set(key, 'revoked', expirySeconds);

	logger.debug({ refreshToken, expirySeconds }, 'Refresh token added to revocation list in Redis');
}

/**
 * Checks if a refresh token is present in the revocation list in Redis.
 *
 * @param refreshToken - The refresh token string to check.
 * @returns A promise resolving to true if the token is revoked, false otherwise.
 */
const isRefreshTokenRevoked =  async (refreshToken: string): Promise<boolean> => {
	const key = `${env.REVOKED_REFRESH_TOKEN_REDIS_PREFIX}${refreshToken}`;
	const isRevoked = await redisService.getClient().exists(key);

	logger.debug({ refreshToken, isRevoked: isRevoked > 0 }, 'Checking if refresh token is revoked in Redis');
	return isRevoked > 0;
}


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
	generateRefreshToken,
	storeRefreshToken,
	getUserIdFromRefreshToken,
	revokeRefreshToken,
	addAccessTokenToRevocationList,
	isAccessTokenRevoked,
	addRefreshTokenToRevocationList,
	isRefreshTokenRevoked,
	verifyAccessToken,
	generateEmailVerificationToken,
	verifyEmailVerficiationToken,
};
