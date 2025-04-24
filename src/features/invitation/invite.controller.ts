import { Request, Response, NextFunction } from 'express';
import { StatusCodes } from 'http-status-codes';
import { InviteStatus, UserRole } from '@prisma/client'; 

import { asyncWrapper } from '../../utils/asyncWrapper'; 
import { inviteService } from './invite.service';
import { authUtils } from '@/utils/auth.utils'; 
import { ApiError, BadRequestError } from '@/utils/ApiError'; 
import { AuthRequest } from '@/middleware/authMiddleware'; 
import logger from '@/config/logger'; 


/**
 * Utility function to safely extract the authenticated user's ID from the request object.
 * (Keep as is, looks good)
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



const createInvitation = asyncWrapper(
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        const inviterId = getUserId(req);
        
        
        const { email, companyId, role } = req.body as { email: string; companyId: string; role?: UserRole };

       
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

const verifyAcceptInviteToken = asyncWrapper(
    async (req: Request, res: Response, next: NextFunction) => { 
        const { token } = req.query as { token: string };

        // Service method throws specific errors on failure
        const verifiedData = await inviteService.verifyInvitation(token);

        if (verifiedData.invitedUserExists) {
            res.status(StatusCodes.OK).json({
                status: 'user_exists',
                message: 'Account already exists. Please log in to link this invitation to your account.',
                email: verifiedData.invitationRecord.email, 
                company: { id: verifiedData.company.id, name: verifiedData.company.name },
            });
        } else {
            res.status(StatusCodes.OK).json({
                status: 'requires_onboarding',
                message: 'Invitation verified. Please complete your registration.',
                email: verifiedData.invitationRecord.email,
                token: token,
            });
        }
    }
);


const completeOnboarding = asyncWrapper(
    async (req: Request, res: Response, next: NextFunction) => { 

        const { token, password, firstName, lastName } = req.body as { token: string, password: string, firstName: string, lastName: string };

        const newUser = await inviteService.completeOnboarding(token, password, firstName, lastName);

        const accessToken = authUtils.generateAccessToken({ id: newUser.id, role: newUser.role, email: newUser.email, isVerified: newUser.isVerified, companyId: newUser.companyId });

        res.status(StatusCodes.CREATED).json({
            message: 'Onboarding successful. Account created.',
            token: accessToken,
            user: { // Return necessary, non-sensitive user info
                id: newUser.id,
                email: newUser.email,
                role: newUser.role,
                companyId: newUser.companyId,
                name: `${firstName} ${lastName}`,
            },
        });
    }
);


const resendInvitation = asyncWrapper(
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        const resenderId = getUserId(req);
        
        const { invitationId } = req.params;

        await inviteService.resendInvitation(invitationId, resenderId);

        res.status(StatusCodes.OK).json({ message: 'Invitation resent successfully.' });
    }
);


const cancelInvitation = asyncWrapper(
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        const cancellerId = getUserId(req);
        
        const { invitationId } = req.params;

        await inviteService.cancelInvitation(invitationId, cancellerId);

        res.status(StatusCodes.OK).json({ message: 'Invitation cancelled successfully.' });
    }
);


const listInvitations = asyncWrapper(
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        const requesterId = getUserId(req);
        const { 
            companyId, 
            status,
            page = '1',
            limit = '10'
        } = req.query as { 
            companyId: string; 
            status?: InviteStatus;
            page?: string;
            limit?: string;
        };

        const pageNumber = Math.max(1, parseInt(page, 10));
        const pageSize = Math.min(100, Math.max(1, parseInt(limit, 10))); // Cap at 100 items

        const { invites, total } = await inviteService.listInvitations(
            companyId, 
            requesterId, 
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
                pages: Math.ceil(total / pageSize)
            }
        });
    }
);


const linkExistingUser = asyncWrapper(
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        const loggedInUserId = getUserId(req); 

        const { token } = req.body as { token: string };

        
        const updatedUser = await inviteService.linkExistingUserToInvite(token, loggedInUserId);

        res.status(StatusCodes.OK).json({
            message: 'Invitation accepted and account linked successfully.',
            user: { 
                id: updatedUser.id,
                email: updatedUser.email,
                companyId: updatedUser.companyId,
                role: updatedUser.role,
            }
        });
    }
);

export const inviteController = {
    createInvitation,
    verifyAcceptInviteToken,
    completeOnboarding,
    resendInvitation,
    cancelInvitation,
    listInvitations,
    linkExistingUser
}