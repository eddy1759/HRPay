import { Request, Response, NextFunction } from 'express';
import { StatusCodes } from 'http-status-codes';
import { InviteStatus, UserRole } from '@prisma/client';

// Import utility functions and services
import { asyncWrapper } from '../../utils/asyncWrapper';
import { inviteService } from './invite.service';
import { authUtils } from '@/utils/auth.utils';
import { ApiError, BadRequestError } from '@/utils/ApiError'; // Import ApiError for custom errors

// Import types and configuration
import { AuthRequest } from '@/middleware/authMiddleware'; // Assuming AuthRequest adds `user` property
import logger from '@/config/logger';

/**
 * @module inviteController
 * @description Controller methods for handling invitation-related API requests.
 *
 * This module contains Express request handlers for creating, verifying,
 * completing, listing, resending, cancelling, and linking user accounts
 * via invitation flows.
 */

/**
 * @function getUserId
 * @description Utility function to safely extract the authenticated user's ID
 * from the request object (added by authentication middleware).
 * Ensures the user object and ID exist and are valid.
 * @param {AuthRequest} req - The Express request object, augmented with user details by authMiddleware.
 * @returns {string} The ID of the authenticated user.
 * @throws {ApiError} If the user or user ID is missing or invalid on the request object.
 */
const getUserId = (req: AuthRequest): string => {
    const user = req.user;
    if (!user || typeof user.id !== 'string' || user.id.trim() === '') {
        logger.error('getUserId failed: req.user or req.user.id is missing/invalid.', {
            hasUser: !!user,
            userIdType: typeof user?.id,
            requestId: (req as any).id
        });
        throw new ApiError(StatusCodes.UNAUTHORIZED, 'User authentication required.');
    }
    return user.id;
};

/**
 * @function createInvitation
 * @description Handles the API request to create a new user invitation.
 * Requires authentication and assumes the authenticated user has permissions
 * to invite new users (e.g., Admin or Owner).
 * @async
 * @param {AuthRequest} req - The Express request object, requires `user` with `id` and `companyId`, and `body` with `email` and optional `role`.
 * @param {Response} res - The Express response object.
 * @param {NextFunction} next - The next middleware function.
 * @returns {Promise<void>} Sends a JSON response with the created invitation details and StatusCodes.CREATED (201).
 * @throws {ApiError} Propagates errors from `inviteService.createInvitation` (e.g., if email is already invited, user already exists, permissions issues).
 */
const createInvitation = asyncWrapper(
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        const inviterId = getUserId(req); // Get ID of the user creating the invitation
        const companyId = req.user.companyId; // Assuming companyId is part of the user object from auth

        const { email, role } = req.body as { email: string; role?: UserRole };

        // Delegate creation and email sending to the service layer
        const invitation = await inviteService.createInvitation(inviterId, companyId, email, role);

        res.status(StatusCodes.CREATED).json({
            message: 'Invitation created and email sent successfully.',
            invitationId: invitation.id,
            email: invitation.email,
            status: invitation.status,
            role: invitation.role,
            expiresAt: invitation.expiresAt,
        });
    }
);

/**
 * @function verifyAcceptInviteToken
 * @description Handles the API request to verify an invitation token received via email.
 * This is typically a public route used before a user logs in or completes onboarding.
 * @async
 * @param {Request} req - The Express request object, expects `query` with a `token` string.
 * @param {Response} res - The Express response object.
 * @param {NextFunction} next - The next middleware function.
 * @returns {Promise<void>} Sends a JSON response indicating whether the token is valid
 * and if the invited user already exists, along with relevant data.
 * @throws {ApiError} Propagates errors from `inviteService.verifyInvitation`
 * (e.g., token invalid, expired, already used).
 */
const verifyAcceptInviteToken = asyncWrapper(
    async (req: Request, res: Response, next: NextFunction) => {
        const { token } = req.query as { token: string };

        // Verify the token using the service layer. Service throws errors on invalid/expired tokens.
        const verifiedData = await inviteService.verifyInvitation(token);

        if (verifiedData.invitedUserExists) {
            // User with this email already exists
            res.status(StatusCodes.OK).json({
                status: 'user_exists',
                message: 'Account already exists. Please log in to link this invitation to your account.',
                email: verifiedData.invitationRecord.email,
                company: { id: verifiedData.company.id, name: verifiedData.company.name },
            });
        } else {
            // Token is valid, user does not exist yet - prompt for onboarding
            res.status(StatusCodes.OK).json({
                status: 'requires_onboarding',
                message: 'Invitation verified. Please complete your registration.',
                email: verifiedData.invitationRecord.email,
                token: token, // Include token for the next step (onboarding completion)
            });
        }
    }
);

/**
 * @function completeOnboarding
 * @description Handles the API request for a new user to complete their registration
 * using a previously verified invitation token.
 * This is typically a public route.
 * @async
 * @param {Request} req - The Express request object, expects `body` with `token`, `password`, `firstName`, and `lastName`.
 * @param {Response} res - The Express response object.
 * @param {NextFunction} next - The next middleware function.
 * @returns {Promise<void>} Sends a JSON response with a success message, the new user's data, and an access token upon successful onboarding. StatusCodes.CREATED (201).
 * @throws {ApiError} Propagates errors from `inviteService.completeOnboarding` (e.g., token invalid/used, validation errors).
 */
const completeOnboarding = asyncWrapper(
    async (req: Request, res: Response, next: NextFunction) => {
        const { token, password, firstName, lastName } = req.body as { token: string, password: string, firstName: string, lastName: string };

        // Complete the onboarding process via the service layer
        const newUser = await inviteService.completeOnboarding(token, password, firstName, lastName);

        // Generate an access token for the newly created user
        const accessToken = authUtils.generateAccessToken({ id: newUser.id, role: newUser.role, email: newUser.email, isVerified: newUser.isVerified, companyId: newUser.companyId });

        res.status(StatusCodes.CREATED).json({
            message: 'Onboarding successful. Account created.',
            token: accessToken,
            user: { // Return necessary, non-sensitive user info
                id: newUser.id,
                email: newUser.email,
                role: newUser.role,
                companyId: newUser.companyId,
                name: `${firstName} ${lastName}`, // Combine name for convenience
            },
        });
    }
);

/**
 * @function resendInvitation
 * @description Handles the API request to resend an existing invitation email.
 * Requires authentication. Assumes the authenticated user has permissions
 * to resend invitations (e.g., Admin or Owner).
 * @async
 * @param {AuthRequest} req - The Express request object, requires `user` with `id` and `params` with `invitationId`.
 * @param {Response} res - The Express response object.
 * @param {NextFunction} next - The next middleware function.
 * @returns {Promise<void>} Sends a JSON response with a success message and StatusCodes.OK (200).
 * @throws {ApiError} Propagates errors from `inviteService.resendInvitation` (e.g., invitation not found, not eligible for resend, permissions issues).
 */
const resendInvitation = asyncWrapper(
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        const resenderId = getUserId(req); // Get ID of the user resending
        const { invitationId } = req.params;

        // Resend the invitation via the service layer
        await inviteService.resendInvitation(invitationId, resenderId);

        res.status(StatusCodes.OK).json({ message: 'Invitation resent successfully.' });
    }
);

/**
 * @function cancelInvitation
 * @description Handles the API request to cancel an existing invitation.
 * Requires authentication. Assumes the authenticated user has permissions
 * to cancel invitations (e.g., Admin or Owner).
 * @async
 * @param {AuthRequest} req - The Express request object, requires `user` with `id` and `params` with `invitationId`.
 * @param {Response} res - The Express response object.
 * @param {NextFunction} next - The next middleware function.
 * @returns {Promise<void>} Sends a JSON response with a success message and StatusCodes.OK (200).
 * @throws {ApiError} Propagates errors from `inviteService.cancelInvitation` (e.g., invitation not found, already accepted/cancelled, permissions issues).
 */
const cancelInvitation = asyncWrapper(
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        const cancellerId = getUserId(req); // Get ID of the user cancelling
        const { invitationId } = req.params;

        // Cancel the invitation via the service layer
        await inviteService.cancelInvitation(invitationId, cancellerId);

        res.status(StatusCodes.OK).json({ message: 'Invitation cancelled successfully.' });
    }
);

/**
 * @function listInvitations
 * @description Handles the API request to list invitations for the authenticated user's company.
 * Requires authentication. Assumes the authenticated user has permissions
 * to view company invitations (e.g., Admin or Owner). Supports filtering and pagination.
 * @async
 * @param {AuthRequest} req - The Express request object, requires `user` with `id` and `companyId`, and optional `query` for filtering/pagination (`status`, `page`, `limit`).
 * @param {Response} res - The Express response object.
 * @param {NextFunction} next - The next middleware function.
 * @returns {Promise<void>} Sends a JSON response with a list of invitations and pagination details. StatusCodes.OK (200).
 * @throws {ApiError} Propagates errors from `inviteService.listInvitations` (e.g., permissions issues).
 */
const listInvitations = asyncWrapper(
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        const requesterId = getUserId(req); // Get ID of the user requesting the list
        const companyId = req.user.companyId; // Get the company ID from the authenticated user

        const {
            status, // Optional filter by status
            page = '1', // Default to page 1
            limit = '10' // Default to 10 items per page
        } = req.query as {
            status?: InviteStatus;
            page?: string;
            limit?: string;
        };

        // Parse and validate pagination parameters
        const pageNumber = Math.max(1, parseInt(page, 10));
        const pageSize = Math.min(100, Math.max(1, parseInt(limit, 10))); // Cap page size

        // Fetch invitations from the service layer with filters and pagination
        const { invites, total } = await inviteService.listInvitations(
            companyId,
            requesterId, // Pass requesterId for permission checks within the service
            status,
            pageNumber,
            pageSize
        );

        res.status(StatusCodes.OK).json({
            invites,
            pagination: {
                page: pageNumber,
                limit: pageSize,
                total,
                pages: Math.ceil(total / pageSize) // Calculate total pages
            }
        });
    }
);

/**
 * @function linkExistingUser
 * @description Handles the API request for an already authenticated user
 * to accept an invitation by linking it to their existing account using a token.
 * Requires authentication.
 * @async
 * @param {AuthRequest} req - The Express request object, requires `user` with `id` and `body` with `token`.
 * @param {Response} res - The Express response object.
 * @param {NextFunction} next - The next middleware function.
 * @returns {Promise<void>} Sends a JSON response with a success message and the updated user's data. StatusCodes.OK (200).
 * @throws {ApiError} Propagates errors from `inviteService.linkExistingUserToInvite` (e.g., token invalid/used, user not found, user already in a company, permissions issues).
 */
const linkExistingUser = asyncWrapper(
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        const loggedInUserId = getUserId(req); // Get the ID of the currently logged-in user

        const { token } = req.body as { token: string };

        // Link the existing user's account to the invitation via the service layer
        const updatedUser = await inviteService.linkExistingUserToInvite(token, loggedInUserId);

        res.status(StatusCodes.OK).json({
            message: 'Invitation accepted and account linked successfully.',
            user: { // Return necessary, non-sensitive updated user info
                id: updatedUser.id,
                email: updatedUser.email,
                companyId: updatedUser.companyId,
                role: updatedUser.role,
            }
        });
    }
);

/**
 * @description Exports the invitation controller methods.
 */
export const inviteController = {
    createInvitation,
    verifyAcceptInviteToken,
    completeOnboarding,
    resendInvitation,
    cancelInvitation,
    listInvitations,
    linkExistingUser
};