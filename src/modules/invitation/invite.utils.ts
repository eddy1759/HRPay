import crypto from 'crypto';
import * as jwt from 'jsonwebtoken';
import { StatusCodes } from 'http-status-codes';

import env from '../../config/env';
import logger from '@/config/logger';
import { prisma } from '../../lib/prisma';
import { InviteJwtPayload, VerifiedInviteData, UserOnboardingData } from './invite.types';
import { UserRole, Invitation, User, Company, InviteStatus } from '@prisma/client';
import { ApiError, InternalServerError, BadRequestError } from '@/utils/ApiError';

/* Error Classes */
export class InvalidInviteTokenError extends ApiError {
	constructor(message = 'Invalid invitation token.') {
		super(StatusCodes.BAD_REQUEST, message);
	}
}

export class ExpiredInviteTokenError extends ApiError {
	constructor(message = 'Invitation token has expired.') {
		super(StatusCodes.BAD_REQUEST, message);
	}
}

export class InvitePermissionError extends ApiError {
	constructor(message = 'Inviter does not have permission to send invites.') {
		super(StatusCodes.FORBIDDEN, message);
	}
}

export class ResourceNotFoundError extends ApiError {
	constructor(resource: string, id: string) {
		super(StatusCodes.NOT_FOUND, `${resource} with ID ${id} not found.`);
	}
}

// --- Helper Functions ---

/**
 * Validates the structure and basic types of the decoded JWT payload.
 * @param decoded - The raw decoded object from jwt.verify.
 * @returns The validated payload as InviteJwtPayload.
 * @throws BadRequestError if validation fails.
 */
const validatePayloadStructure = (decoded: unknown): InviteJwtPayload => {
	if (
		typeof decoded !== 'object' ||
		decoded === null ||
		typeof (decoded as any).email !== 'string' ||
		!(decoded as any).email ||
		typeof (decoded as any).dbToken !== 'string' ||
		!(decoded as any).dbToken ||
		typeof (decoded as any).companyId !== 'string' ||
		!(decoded as any).companyId
	) {
		logger.warn('Invalid JWT payload structure received', { payload: decoded });
		throw new BadRequestError('Token payload structure is invalid.');
	}

	return decoded as InviteJwtPayload;
};

/**
 * Generates a secure random token for DB storage and its expiry date.
 * @returns Object containing the token and its expiry date.
 */
const generateRandomTokenAndExpiryDate = (): { token: string; expiresAt: Date } => {
	const token = crypto.randomBytes(16).toString('hex');
	const expiresAt = new Date(Date.now() + env.DB_TOKEN_EXPIRY_HOURS * 60 * 60 * 1000);

	return {
		token,
		expiresAt,
	};
};

/**
 * Generates a signed JWT containing essential info to link back to a DB invite record.
 * @param payloadData - Data required for the JWT payload (email, dbToken, companyId).
 * @returns The signed JWT string.
 * @throws InternalServerError if JWT signing fails.
 */
const generateInviteToken = async (payloadData: InviteJwtPayload): Promise<string> => {
	try {
		const token = jwt.sign(payloadData, env.INVITE_SECRET, {
			expiresIn: env.INVITE_JWT_EXPIRY,
		} as jwt.SignOptions);

		return token;
	} catch (error) {
		logger.error('Error signing JWT for invitation:', error);
		throw new InternalServerError('Failed to generate invitation token.');
	}
};

/**
 * Verifies an invitation JWT and the corresponding DB record state.
 * Fetches related records (inviter, company) and checks user existence.
 * @param token - The JWT string from the invite link.
 * @returns VerifiedInviteData object upon successful verification.
 * @throws ApiError derivatives if verification fails.
 */
const verifyInviteTokenAndState = async (token: string): Promise<VerifiedInviteData> => {
	let decodedPayload: InviteJwtPayload;

	try {
		const decoded = jwt.verify(token, env.INVITE_SECRET);
		decodedPayload = validatePayloadStructure(decoded);
	} catch (error: any) {
		if (error instanceof jwt.TokenExpiredError) {
			logger.warn(`JWT expired: ${error.message}`);
			throw new ExpiredInviteTokenError('Invitation link has expired (JWT).');
		}
		if (error instanceof jwt.JsonWebTokenError) {
			logger.warn(`Invalid JWT received: ${error.message}`);
			throw new InvalidInviteTokenError(`Invalid invitation link: ${error.message}`);
		}
		if (error instanceof ApiError) {
			throw error;
		}
		logger.error('Unexpected error during JWT verification:', error);
		throw new InvalidInviteTokenError('Could not verify invitation link.');
	}

	const { dbToken } = decodedPayload;

	try {
		// Retrieve the invitation record
		const inviteFromDb = await prisma.invitation.findUnique({
			where: { token: dbToken },
			include: {
				company: true,
				invitedByUser: true,
			},
		});

		if (!inviteFromDb) {
			logger.warn(`Invitation record not found for dbToken: ${dbToken}`);
			throw new InvalidInviteTokenError('Invitation details not found or already used.');
		}

		// Check if related company exists (should always if FK is enforced, but good check)
		if (!inviteFromDb.company) {
			logger.error(
				`Data integrity issue: Invitation ${inviteFromDb.id} missing company link.`
			);
			throw new InternalServerError('Error retrieving invitation details.');
		}

		// Sanity Check: Compare JWT email/companyId with DB record for extra safety
		if (
			inviteFromDb.email.toLowerCase() !== decodedPayload.email.toLowerCase() ||
			inviteFromDb.companyId !== decodedPayload.companyId
		) {
			logger.error('JWT payload mismatch with DB record!', {
				jwtPayload: decodedPayload,
				dbInviteId: inviteFromDb.id,
			});
			throw new InvalidInviteTokenError('Invitation details mismatch.');
		}

		// Check DB status - allow only PENDING invites to be verified for acceptance
		if (inviteFromDb.status !== InviteStatus.PENDING) {
			logger.warn(
				`Invitation ${inviteFromDb.id} (dbToken ${dbToken}) has status ${inviteFromDb.status}, not PENDING.`
			);
			if (inviteFromDb.status === InviteStatus.ACCEPTED) {
				throw new InvalidInviteTokenError('Invitation link has already been used.');
			} else {
				throw new InvalidInviteTokenError(
					`Invitation is no longer valid (Status: ${inviteFromDb.status}).`
				);
			}
		}

		// Validate invitation expiry from DB
		if (new Date(inviteFromDb.expiresAt) < new Date()) {
			logger.warn(
				`DB Invitation expired for dbToken: ${dbToken}. Expiry: ${inviteFromDb.expiresAt}`
			);
			throw new ExpiredInviteTokenError('Invitation link has expired.');
		}

		// Check inviter permissions (using invitedByUser from included data)
		// Check if inviter exists (might be null due to SetNull)

		const inviter = inviteFromDb.invitedByUser;
		if (inviter) {
			// Only check permissions if the inviter user still exists
			// Define roles allowed to *send* invites here or pass from service if needed
			const rolesAllowedToSend: UserRole[] = [UserRole.ADMIN, UserRole.SUPER_ADMIN];

			if (!rolesAllowedToSend.includes(inviter.role as UserRole)) {
				logger.warn(
					`Inviter ${inviter.id} (Role: ${inviter.role}) lacks permission for invite ${inviteFromDb.id}.`
				);
				// Throw a generic error, as the invite *was* created, but maybe shouldn't be used now?
				// Or maybe allow it if they had permission *at the time of creation*? Business decision.
				// For now, let's throw indicating a potential issue with the invite's origin.
				throw new InvalidInviteTokenError('Invitation origin cannot be fully verified.');
			}
		} else if (inviteFromDb.invitedById) {
			// Log if inviter ID exists but user doesn't (due to SetNull)
			logger.warn(
				`Inviter user ${inviteFromDb.invitedById} for invitation ${inviteFromDb.id} no longer exists.`
			);
			// Decide if invite is still valid. Usually yes, unless strict policy requires active inviter.
		}

		// Check if invited user already exists
		const existingUser = await prisma.user.findUnique({
			where: { email: inviteFromDb.email },
			select: { id: true },
		});

		return {
			payload: decodedPayload, // Return the validated JWT payload
			invitationRecord: inviteFromDb,
			inviter: inviter, // Can be null
			company: inviteFromDb.company, // Company guaranteed by include + check
			invitedUserExists: !!existingUser,
		};
	} catch (error) {
		if (error instanceof ApiError) {
			// Includes custom errors like InvalidInviteTokenError, etc.
			throw error;
		}
		logger.error(
			`Unexpected error verifying DB state for invite via dbToken ${dbToken}:`,
			error
		);
		throw new InternalServerError(
			'An unexpected error occurred while checking invitation status.'
		);
	}
};

/**
 * Constructs the full URL for the invitation link using frontend base URL from config.
 * @param jwtToken - The generated JWT for the invitation.
 * @returns The full invitation URL string.
 * @throws InternalServerError if FRONTEND_URL is not configured.
 */
const buildInvitationUrl = (token: string): string => {
	const url = new URL('/accept-invite', env.FRONTEND_URL); // Example path
	url.searchParams.set('token', token); // Add the token as a query parameter
	return url.toString();
};

/**
 * Cleans up expired invitations by marking pending invitations with past expiry as EXPIRED.
 * Adjust InviteStatus.EXPIRED as necessary to match your Prisma schema.
 * Returns the count of updated records.
 */
const cleanupExpiredInvitations = async (): Promise<number> => {
	try {
		const now = new Date();
		const result = await prisma.invitation.updateMany({
			where: {
				expiresAt: { lt: now },
				status: 'PENDING',
			},
			data: { status: 'EXPIRED' },
		});
		logger.info(`Cleaned up ${result.count} expired invitations.`);
		return result.count;
	} catch (error) {
		logger.error('Failed to cleanup expired invitations:', error);
		throw new InternalServerError('Could not cleanup expired invitations.');
	}
};

export const inviteUtils = {
	generateInviteToken,
	verifyInviteTokenAndState,
	buildInvitationUrl,
	cleanupExpiredInvitations,
	generateRandomTokenAndExpiryDate,
};
