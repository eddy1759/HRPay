import { z } from 'zod';
import { UserRole, InviteStatus } from '@prisma/client'; 

export const createInviteSchema = z.object({
	body: z.object({
		email: z.string().email({ message: 'Invalid email address' }),
		role: z.nativeEnum(UserRole).optional().default(UserRole.EMPLOYEE),
	}),
});

export const acceptInviteQuerySchema = z.object({
	query: z.object({
		token: z.string().min(1, { message: 'Invitation token is required' }),
	}),
});

export const completeOnboardingSchema = z.object({
	body: z.object({
		token: z.string().min(1, { message: 'Invitation token is required' }),
		password: z.string().min(8, { message: 'Password must be at least 8 characters long' }), 
		firstName: z.string().min(1, { message: 'First name is required' }),
		lastName: z.string().min(1, { message: 'Last name is required' }),
	}),
});

export const inviteIdParamSchema = z.object({
	params: z.object({
		invitationId: z.string().uuid({ message: 'Invalid invitation ID format' }),
	}),
});

export const listInvitesQuerySchema = z.object({
	query: z.object({
		companyId: z.string().uuid({ message: 'Invalid company ID' }),
		status: z.nativeEnum(InviteStatus).optional(),
	}),
});

export const linkAccountSchema = z.object({
    body: z.object({
        token: z.string().min(1, { message: "Invitation token is required" }),
    }),
});
