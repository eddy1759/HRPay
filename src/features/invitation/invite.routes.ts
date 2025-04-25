import express from 'express';
import { inviteController} from './invite.controller';
import { validate } from '@/middleware/validate';
import { authMiddleware } from '@/middleware/authMiddleware'; 
import {
    createInviteSchema,
    acceptInviteQuerySchema,
    completeOnboardingSchema,
    inviteIdParamSchema,
    listInvitesQuerySchema,
    linkAccountSchema
} from './invite.validation';


/**
 * @module inviteRouter
 * @description Express router for the invitation feature.
 *
 * Defines the API endpoints related to user invitations, including
 * creation, verification, acceptance, cancellation, and listing.
 */

/**
 * @description Express Router instance specifically for invitation routes.
 * @constant
 */
const inviteRouter = express.Router();

// --- Public Routes ---

/**
 * GET /api/v1/invites/verify
 * @description Verifies an invitation token provided in the query parameters.
 * This route is public and does not require authentication.
 * @middleware {validate} Validates the `token` query parameter against `acceptInviteQuerySchema`.
 * @handler {inviteController.verifyAcceptInviteToken} Handles the token verification logic.
 */
inviteRouter.get(
    '/verify',
    validate(acceptInviteQuerySchema),
    inviteController.verifyAcceptInviteToken
);

/**
 * POST /api/v1/invites/complete
 * @description Completes the onboarding process for a new user using a verified invitation token.
 * This route is public and does not require authentication.
 * @middleware {validate} Validates the request body against `completeOnboardingSchema`.
 * @handler {inviteController.completeOnboarding} Handles the user creation and onboarding completion.
 */
inviteRouter.post(
    '/complete',
    validate(completeOnboardingSchema),
    inviteController.completeOnboarding
);

// --- Protected Routes (Require authentication via authMiddleware) ---

/**
 * POST /api/v1/invites
 * @description Creates a new invitation for a user.
 * Requires authentication. Typically accessible by users with invitation permissions (e.g., Admin).
 * @middleware {authMiddleware} Ensures the user is authenticated.
 * @middleware {validate} Validates the request body against `createInviteSchema`.
 * @handler {inviteController.createInvitation} Handles the invitation creation and email sending.
 */
inviteRouter.post(
    '/',
    authMiddleware,
    validate(createInviteSchema),
    inviteController.createInvitation
);

/**
 * GET /api/v1/invites
 * @description Lists invitations for the authenticated user's company.
 * Requires authentication. Typically accessible by users with appropriate viewing permissions (e.g., Admin).
 * Supports filtering by status and pagination via query parameters.
 * @middleware {authMiddleware} Ensures the user is authenticated.
 * @middleware {validate} Validates query parameters against `listInvitesQuerySchema`.
 * @handler {inviteController.listInvitations} Handles fetching and returning the list of invitations.
 */
inviteRouter.get(
    '/',
    authMiddleware, // Use your actual middleware
    validate(listInvitesQuerySchema),
    inviteController.listInvitations
);

/**
 * POST /api/v1/invites/:invitationId/resend
 * @description Resends a specific invitation email.
 * Requires authentication. Typically accessible by users with permission to manage invitations.
 * @param {string} invitationId - The ID of the invitation to resend (from URL params).
 * @middleware {authMiddleware} Ensures the user is authenticated.
 * @middleware {validate} Validates the `invitationId` URL parameter against `inviteIdParamSchema`.
 * @handler {inviteController.resendInvitation} Handles the invitation resending logic.
 */
inviteRouter.post(
    '/:invitationId/resend',
    authMiddleware, // Use your actual middleware
    validate(inviteIdParamSchema),
    inviteController.resendInvitation
);

/**
 * DELETE /api/v1/invites/:invitationId
 * @description Cancels a specific invitation.
 * Requires authentication. Typically accessible by users with permission to manage invitations.
 * @param {string} invitationId - The ID of the invitation to cancel (from URL params).
 * @middleware {authMiddleware} Ensures the user is authenticated.
 * @middleware {validate} Validates the `invitationId` URL parameter against `inviteIdParamSchema`.
 * @handler {inviteController.cancelInvitation} Handles the invitation cancellation logic.
 */
inviteRouter.delete(
    '/:invitationId',
    authMiddleware, // Use your actual middleware
    validate(inviteIdParamSchema),
    inviteController.cancelInvitation
);

/**
 * POST /api/v1/invites/link-account
 * @description Allows an already authenticated user to accept an invitation by linking it to their existing account using a token.
 * Requires authentication.
 * @middleware {authMiddleware} Ensures the user is authenticated.
 * @middleware {validate} Validates the request body against `linkAccountSchema` (expects the token).
 * @handler {inviteController.linkExistingUser} Handles the account linking process.
 */
inviteRouter.post(
    '/link-account',
    authMiddleware, // Use your actual middleware
    validate(linkAccountSchema), // Use the validation schema
    inviteController.linkExistingUser
);

/**
 * @description Exports the invitation router.
 * @exports default inviteRouter
 */
export default inviteRouter;