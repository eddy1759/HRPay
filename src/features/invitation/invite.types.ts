import * as jwt from 'jsonwebtoken';
import { Invitation, User, Company, EmployeeUserRole } from '@prisma/client';

/* Interfaces */
export interface InviteJwtPayload extends jwt.JwtPayload {
	email: string;
	dbToken: string;
	companyId: string;
}

export interface VerifiedInviteData {
	payload: InviteJwtPayload; // Use the more specific JWT payload type
	invitationRecord: Invitation;
	inviter: User | null; // Inviter might be null if user deleted (SetNull)
	company: Company;
	invitedUserExists: boolean;
}

export interface UserOnboardingData {
	email: string; // From verified token/invite record
	hashedPassword: string; // Password MUST be hashed before passing here
	companyId: string; // From verified token/invite record
	role: EmployeeUserRole; // From verified token/invite record
	firstName: string; // Collected from user
	lastName: string; // Collected from user
}
