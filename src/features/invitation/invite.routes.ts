// src/features/invites/invite.routes.ts
import express from 'express';
import { inviteController} from './invite.controller';
import { validate } from '@/middleware/validate'; 
import { authMiddleware } from '@/middleware/authMiddleware'; // Adjust path if needed
import {
    createInviteSchema,
    acceptInviteQuerySchema, 
    completeOnboardingSchema, 
    inviteIdParamSchema,
    listInvitesQuerySchema,
    linkAccountSchema 
} from './invite.validation';

const inviteRouter = express.Router();

// --- Public Routes ---

inviteRouter.get(
    '/verify',
    validate(acceptInviteQuerySchema),
    inviteController.verifyAcceptInviteToken
);
inviteRouter.post(
    '/complete',
    validate(completeOnboardingSchema),
    inviteController.completeOnboarding
);


// --- Protected Routes (Require authentication) ---
// POST /api/v1/invites - Create a new invitation
inviteRouter.post(
    '/',
    authMiddleware, 
    validate(createInviteSchema),
    inviteController.createInvitation
);

// GET /api/v1/invites?companyId=...[&status=...] - List invitations for a company
inviteRouter.get(
    '/',
    authMiddleware, // Use your actual middleware
    validate(listInvitesQuerySchema),
    inviteController.listInvitations
);

// POST /api/v1/invites/:invitationId/resend - Resend a specific invitation
inviteRouter.post(
    '/:invitationId/resend',
    authMiddleware, // Use your actual middleware
    validate(inviteIdParamSchema),
    inviteController.resendInvitation
);

// DELETE /api/v1/invites/:invitationId - Cancel a specific invitation
inviteRouter.delete(
    '/:invitationId',
    authMiddleware, // Use your actual middleware
    validate(inviteIdParamSchema),
    inviteController.cancelInvitation
);

// POST /api/v1/invites/link-account - Authenticated user accepts invite via token
inviteRouter.post(
    '/link-account',
    authMiddleware, // Use your actual middleware
    validate(linkAccountSchema), // Use the validation schema
    inviteController.linkExistingUser
);


export default inviteRouter;