import {
	Prisma,
	Invitation,
	UserRole,
	InviteStatus,
	User,
	PrismaClient,
} from '@prisma/client';

import { prisma } from '@/lib/prisma';
import logger from '@/config/logger';
import { authUtils } from '@/utils/auth.utils';
import { inviteUtils, InvitePermissionError } from './invite.utils';
import { emailService } from '@/emails/email.service';
import { InviteJwtPayload, VerifiedInviteData, UserOnboardingData } from './invite.types';
import {
	ConflictError,
	InternalServerError,
	NotFoundError,
	ForbiddenError,
	ApiError,
	UnauthorizedError,
	BadRequestError,
} from '../../utils/ApiError';

// Roles allowed to perform invite actions (create, cancel, resend, list)
const MANAGER_ROLES = [UserRole.ADMIN, UserRole.SUPER_ADMIN];

class InviteService {
	constructor(
		private prismaClient: Prisma.TransactionClient | typeof prisma = prisma,
		private emailer = emailService
	) {}

	/**
	 * Validates if a user has permission to manage invites for a specific company.
	 * Checks user existence, role, and company association (if not SUPER_ADMIN).
	 * @param userId - The ID of the user performing the action.
	 * @param companyId - The ID of the target company.
	 * @param allowedRoles - List of roles permitted for the action.
	 * @throws NotFoundError if user not found.
	 * @throws ForbiddenError if user doesn't belong to company (and isn't SUPER_ADMIN).
	 * @throws InvitePermissionError if user role is not allowed.
	 */
	private async _validateManagerPermissions(
		userId: string,
		companyId: string,
		allowedRoles: UserRole[] = MANAGER_ROLES
	): Promise<User> {
		const user = await this.prismaClient.user.findUnique({ where: { id: userId } });
		if (!user) {
			throw new NotFoundError(`User ${userId} performing action not found.`);
		}
		// SUPER_ADMIN bypasses company check but still needs role check if specific roles are required
		if (user.role !== UserRole.SUPER_ADMIN && user.companyId !== companyId) {
			throw new ForbiddenError(
				'You do not have permission to manage resources for this company.'
			);
		}
		if (!allowedRoles.includes(user.role)) {
			throw new InvitePermissionError(
				`Your role (${user.role}) does not permit this action.`
			);
		}
		return user;
	}

	/**
	 * Creates a new invitation, saves it, and sends an invitation email.
	 * @param inviterId - The ID of the user sending the invite.
	 * @param companyId - The ID of the company the invitee will join.
	 * @param inviteeEmail - The email address of the person being invited.
	 * @param role - The role to assign upon acceptance.
	 * @returns The created Invitation record.
	 * @throws ApiError derivatives on failure (permissions, validation, conflicts, etc.)
	 */

	async createInvitation(
		inviterId: string,
		companyId: string,
		inviteeEmail: string,
		role: UserRole = UserRole.EMPLOYEE
	): Promise<Invitation> {
		const lowerCaseEmail = inviteeEmail.toLowerCase();

		// Verify Inviter Permissions and Company Existence
		await this._validateManagerPermissions(inviterId, companyId);
		const company = await this.prismaClient.company.findUnique({ where: { id: companyId } });

		if (!company) throw new NotFoundError(`Company with ID ${companyId} not found.`);

		// Check for Existing User in the Same Company
		const existingUserInCompany = await this.prismaClient.user.findFirst({
			where: {
				email: lowerCaseEmail,
				companyId: companyId,
			},
			select: { id: true },
		});

		if (existingUserInCompany) {
			throw new ConflictError(
				`User with email ${lowerCaseEmail} already exists in company ${company.name}.`
			);
		}

		// Check for Existing PENDING Invitation (using schema's unique index)
		const existingPendingInvite = await this.prismaClient.invitation.findUnique({
			where: {
				email_companyId_status: {
					// Using @@unique constraint name from schema
					email: lowerCaseEmail,
					companyId: companyId,
					status: InviteStatus.PENDING,
				},
			},
		});

		if (existingPendingInvite) {
			logger.warn(
				`Pending invitation already exists for ${lowerCaseEmail} in company ${companyId}.`
			);
			throw new ConflictError(
				`A pending invitation already exists for ${lowerCaseEmail}. Ask the user to check their email or resend the existing invitation.`
			);
		}

		// Generate Tokens and Expiry
		const { token: dbToken, expiresAt } = inviteUtils.generateRandomTokenAndExpiryDate();

		// Create Invitation Record in DB (within a transaction if combined with other writes)
		let invitation: Invitation;
		try {
			invitation = await this.prismaClient.invitation.create({
				data: {
					email: lowerCaseEmail,
					role: role,
					token: dbToken, // Store the secure random token
					expiresAt: expiresAt,
					company: { connect: { id: companyId } },
					invitedByUser: { connect: { id: inviterId } },
					status: InviteStatus.PENDING,
				},
			});
			logger.info(
				`Invitation record created for ${lowerCaseEmail}, company ${companyId}, inviter ${inviterId}.`
			);
		} catch (error: any) {
			if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
				// Catch potential race condition for unique constraint
				logger.warn(
					`Potential race condition or duplicate invite creation attempt for ${lowerCaseEmail}, company ${companyId}.`
				);
				throw new ConflictError(
					`An invitation for ${lowerCaseEmail} might have just been created.`
				);
			}
			logger.error(`Failed to create invitation DB record for ${lowerCaseEmail}:`, error);
			throw new InternalServerError('Failed to save invitation details.');
		}

		// Generate JWT for the email link
		const jwtPayload = {
			email: invitation.email,
			dbToken: invitation.token,
			companyId: invitation.companyId,
		};
		const emailJwt = await inviteUtils.generateInviteToken(jwtPayload);
		const invitationUrl = inviteUtils.buildInvitationUrl(emailJwt);

		try {
			await this.emailer.sendUserInvitation(company.name, invitation.email, invitationUrl);
			logger.info(
				`Invitation email successfully sent to ${invitation.email} for invite ${invitation.id}`
			);
		} catch (error) {
			logger.error(
				`CRITICAL: Failed to send invitation email for invite ID ${invitation.id} to ${invitation.email}:`,
				error
			);
		}

		return invitation;
	}

	/**
	 * Verifies an invitation token (JWT and DB state).
	 * @param token - The JWT received from the invitation link.
	 * @returns VerifiedInviteData containing payload, records, and existence flag.
	 * @throws ApiError derivatives if verification fails.
	 */
	async verifyInvitation(token: string): Promise<VerifiedInviteData> {
		try {
			const verifiedData = await inviteUtils.verifyInviteTokenAndState(token);
			logger.info(
				`Invitation token verified successfully for email ${verifiedData.payload.email}`
			);
			return verifiedData;
		} catch (error) {
			// Log or handle specific util errors if needed, otherwise rethrow
			if (error instanceof ApiError) {
				logger.warn(
					`Invitation verification failed: ${error.message} (Status: ${error.statusCode})`
				);
				throw error; // Re-throw known API errors
			}
			logger.error(`Unexpected error during invitation verification:`, error);
			throw new InternalServerError(
				'An unexpected error occurred while verifying the invitation.'
			);
		}
	}

	/**
	 * Completes the onboarding process for a user after accepting an invitation token.
	 * Creates User, optionally Employee, and updates Invitation status within a transaction.
	 * @param token - The verified invitation jwt.
	 * @param password - The new user's plain text password.
	 * @param firstName - The new user's first name.
	 * @param lastName - The new user's last name.
	 * @returns The newly created User object.
	 * @throws ApiError derivatives if verification or onboarding fails.
	 */

	async completeOnboarding(
		token: string,
		password: string,
		firstName: string,
		lastName: string
	): Promise<User> {
		// Verify the invitation token and extract data
		const verifiedData = await this.verifyInvitation(token);

		if (verifiedData.invitedUserExists) {
			logger.warn(
				`Onboarding attempt failed: User ${verifiedData.invitationRecord.email} already exists.`
			);
			throw new ConflictError('An account with this email already exists. Please log in.');
		}

		// Hash the password
		const hashedPassword = await authUtils.hashPassword(password);

		// Prepare the data for the transaction using verified data
		const userData: UserOnboardingData = {
			email: verifiedData.invitationRecord.email,
			hashedPassword: hashedPassword,
			companyId: verifiedData.invitationRecord.id,
			role: UserRole.EMPLOYEE,
			firstName: firstName,
			lastName: lastName,
		};

		const invitationId = verifiedData.invitationRecord.id;
		let newUser;

		// Execute onboarding transaction
		try {
			// If we're already in a transaction, use the client directly
			if (this.prismaClient instanceof PrismaClient) {
				newUser = await this.prismaClient.$transaction(async (prisma) => {
					// Create the user
					const createdUser = await prisma.user.create({
						data: {
							email: userData.email,
							password: userData.hashedPassword,
							companyId: userData.companyId,
							role: userData.role,
							isVerified: true, // Set to true upon onboarding
						},
					});
					logger.info(`User ${createdUser.id} created.`);

					// Create Employee if role requires it
					await prisma.employee.create({
						data: {
							firstName: userData.firstName,
							lastName: userData.lastName,
							email: userData.email, // Match user email
							startDate: new Date(), // Set current date as start date
							companyId: userData.companyId,
							userId: createdUser.id, // Link to user
						},
					});
					logger.info(`Employee record linked for User ${createdUser.id}.`);

					// Update the invitation status to ACCEPTED
					await prisma.invitation.update({
						where: { id: invitationId },
						data: { status: InviteStatus.ACCEPTED, acceptedByUserId: createdUser.id },
						select: { id: true },
					});
					return createdUser;
				});
				logger.info(
					`Onboarding successfully completed for user: ${newUser.email} (ID: ${newUser.id})`
				);
				return newUser;
			} else {
				// If we're already in a transaction, execute the operations directly
				const createdUser = await this.prismaClient.user.create({
					data: {
						email: userData.email,
						password: userData.hashedPassword,
						companyId: userData.companyId,
						role: userData.role,
						isVerified: true,
					},
				});
				logger.info(`User ${createdUser.id} created.`);

				await this.prismaClient.employee.create({
					data: {
						firstName: userData.firstName,
						lastName: userData.lastName,
						email: userData.email,
						startDate: new Date(), // Set current date as start date
						company: { connect: { id: userData.companyId } },
						user: { connect: { id: createdUser.id } },
					},
				});
				logger.info(`Employee record linked for User ${createdUser.id}.`);

				await this.prismaClient.invitation.update({
					where: { id: invitationId },
					data: { status: InviteStatus.ACCEPTED, acceptedByUserId: createdUser.id },
					select: { id: true },
				});
				logger.info(`Invitation ${invitationId} marked as ACCEPTED.`);

				logger.info(
					`Onboarding successfully completed for user: ${createdUser.email} (ID: ${createdUser.id})`
				);
				return createdUser;
			}
			logger.info(
				`Onboarding successfully completed for user: ${newUser.email} (ID: ${newUser.id})`
			);
			return newUser;
		} catch (error) {
			logger.error(
				`Onboarding transaction failed for email ${userData.email}, invitation ${invitationId}:`,
				error
			);
			// Handle specific Prisma errors if necessary (like in utils example)
			if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
				throw new ConflictError(
					'Onboarding failed due to a data conflict (e.g., email race condition).'
				);
			}
			if (error instanceof ApiError) throw error; // Re-throw known API errors
			throw new InternalServerError(
				'Failed to complete onboarding process due to a database error.'
			);
		}
	}

	/**
	 * Resends a pending invitation. Regenerates tokens and sends a new email.
	 */
	async resendInvitation(invitationId: string, resenderId: string): Promise<void> {
		// Find invitation and verify resender permissions
		const invitation = await this.prismaClient.invitation.findUnique({
			where: { id: invitationId },
			include: { company: true }, 
		});

		if (!invitation) throw new NotFoundError('Invitation not found.');
		if (!invitation.company)
			throw new InternalServerError('Invitation data integrity issue: missing company.');
		if (invitation.status !== InviteStatus.PENDING) {
			throw new BadRequestError('Only PENDING invitations can be resent.');
		}

		// Check permissions using helper
		await this._validateManagerPermissions(resenderId, invitation.companyId);

		// Regenerate DB token and expiry date
		const { token: newDbToken, expiresAt: newExpiresAt } =
			inviteUtils.generateRandomTokenAndExpiryDate();

		// Update the invitation record with the new token and expiry
		try {
			await this.prismaClient.invitation.update({
				where: { id: invitationId },
				data: {
					token: newDbToken,
					expiresAt: newExpiresAt,
					status: InviteStatus.PENDING
				},
				select: { id: true }, // Update minimal fields
			});
			logger.info(`Updated DB token/expiry for invitation ${invitationId}.`);
		} catch (error) {
			logger.error(`Failed to update DB token for resend, invite ${invitationId}:`, error);
			throw new InternalServerError('Failed to refresh invitation details.');
		}

		// Generate a new JWT using the new DB token
		const jwtPayload = {
			email: invitation.email,
			dbToken: newDbToken, // Use the NEW DB token
			companyId: invitation.companyId,
		};
		const newEmailJwt = await inviteUtils.generateInviteToken(jwtPayload);
		const newInvitationUrl = inviteUtils.buildInvitationUrl(newEmailJwt);

		// Send email with the new URL (async)
		this.emailer
			.sendUserInvitation(invitation.company.name, invitation.email, newInvitationUrl)
			.then(() =>
				logger.info(
					`Resent invitation email successfully queued/sent to ${invitation.email} for invite ${invitationId}`
				)
			)
			.catch((emailError) => {
				logger.error(
					`CRITICAL: Failed to RESEND invitation email for invite ID ${invitation.id} to ${invitation.email}:`,
					emailError
				);
				// Logged, but operation doesn't fail here.
			});
	}

	/**
	 * Cancels a pending invitation by setting its status to CANCELLED.
	 */
	async cancelInvitation(invitationId: string, cancellerId: string): Promise<void> {
		// Find invitation and check status
		const invitation = await this.prismaClient.invitation.findUnique({
			where: { id: invitationId },
			select: { id: true, status: true, companyId: true }, // Select fields needed
		});

		if (!invitation) throw new NotFoundError('Invitation not found.');
		if (invitation.status !== InviteStatus.PENDING) {
			throw new BadRequestError('Only PENDING invitations can be cancelled.');
		}

		// Verify canceller permissions
		await this._validateManagerPermissions(cancellerId, invitation.companyId);

		// Update status to CANCELLED
		try {
			await this.prismaClient.invitation.update({
				where: { id: invitationId },
				data: { status: InviteStatus.CANCELLED },
				select: { id: true },
			});
			logger.info(`Invitation ${invitationId} cancelled by user ${cancellerId}.`);
		} catch (error) {
			logger.error(`Failed to cancel invitation ${invitationId}:`, error);
			if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
				throw new NotFoundError('Invitation not found during update.'); // Race condition?
			}
			throw new InternalServerError('Failed to update invitation status.');
		}
	}

	/**
	 * Lists invitations for a specific company, optionally filtered by status.
	 */
	async listInvitations(
		companyId: string,
		requesterId: string,
		status?: InviteStatus,
		page: number = 1,
    	limit: number = 10
	): Promise<{ invites: Invitation[]; total: number }> {
		try {
			const skip = (page - 1) * limit;

			await this._validateManagerPermissions(requesterId, companyId);

			const [invites, total] = await Promise.all([
				prisma.invitation.findMany({
					where: {
						companyId,
						...(status && { status })
					},
					skip,
					take: limit,
					orderBy: {
						createdAt: 'desc'
					}
				}),
				prisma.invitation.count({
					where: {
						companyId,
						...(status && { status })
					}
				})
			]);

		return { invites, total };
		} catch (error) {
			logger.error(`Failed to list invitations for company ${companyId}:`, error);
			throw new InternalServerError('Failed to retrieve invitations.');
		}
	}

    /**
     * Links an existing, authenticated user to the company specified in a valid invitation.
     * Marks the invitation as accepted.
     * @param token - The invitation JWT.
     * @param loggedInUserId - The ID of the currently authenticated user attempting to accept.
     * @returns The updated User object (or relevant confirmation).
     * @throws ApiError derivatives on failure (token invalid, user mismatch, already linked, etc.)
     */
    async linkExistingUserToInvite(token: string, loggedInUserId: string): Promise<User> {
        // 1. Verify the invitation token again for current validity
        const verifiedData = await this.verifyInvitation(token);
        const { invitationRecord, company } = verifiedData;

        // 2. Verify the logged-in user is the intended recipient
        const loggedInUser = await this.prismaClient.user.findUnique({ where: { id: loggedInUserId } });
        if (!loggedInUser) {
            // This shouldn't typically happen if auth middleware is working
            throw new UnauthorizedError('Authenticated user not found.');
        }
        if (loggedInUser.email.toLowerCase() !== invitationRecord.email.toLowerCase()) {
            logger.warn(`User ${loggedInUserId} (${loggedInUser.email}) tried to accept invite for ${invitationRecord.email}.`);
            throw new ForbiddenError('This invitation is intended for a different email address.');
        }

        // 3. Check if user needs linking or is already linked
        if (loggedInUser.companyId === company.id) {
            logger.warn(`User ${loggedInUserId} is already linked to company ${company.id}. Invite ${invitationRecord.id} may be redundant.`);
            // Still mark the specific invite as accepted if it was pending
            // (Handles cases like re-inviting for role changes, though role update isn't implemented here)
             await this.prismaClient.invitation.update({
                where: { id: invitationRecord.id },
                data: {
                    status: InviteStatus.ACCEPTED,
                    acceptedByUserId: loggedInUserId,
                },
                select: { id: true }
             });
             logger.info(`Redundant invitation ${invitationRecord.id} marked accepted for already linked user ${loggedInUserId}.`);
            // Perhaps just return the user without making changes other than invite status
             return loggedInUser;

        } else if (loggedInUser.companyId) {
            // User is linked to a *different* company. Schema doesn't allow multiple companies.
            logger.warn(`User ${loggedInUserId} already belongs to company ${loggedInUser.companyId} and cannot accept invite to company ${company.id}.`);
            throw new ConflictError('Your account is already associated with a different company.');
        }

        // 4. Link user to the company and accept invite (within a transaction)
		logger.info(`Linking existing user ${loggedInUserId} to company ${company.id} via invitation ${invitationRecord.id}.`);
		try {
			const [, updatedUser] = await prisma.$transaction([
				 // Update Invitation status
				 this.prismaClient.invitation.update({
					  where: { id: invitationRecord.id },
                      data: {
                           status: InviteStatus.ACCEPTED,
                           acceptedByUserId: loggedInUserId,
                      },
                      select: { id: true } // Minimal selection
                 }),
                 // Update User's companyId
                 this.prismaClient.user.update({
                      where: { id: loggedInUserId },
                      data: {
                           companyId: company.id,
                           // IMPORTANT: Role Update Logic Needed?
                           // If the invite role is different from user's current role,
                           // should it be updated? This depends on business rules.
                           // Example: role: invitationRecord.role
                      },
                 }),
            ]);
             logger.info(`User ${loggedInUserId} successfully linked to ${company.id}. Invitation ${invitationRecord.id} accepted.`);
            return updatedUser;
        } catch (error) {
             logger.error(`Failed to link user ${loggedInUserId} to company ${company.id} via invite ${invitationRecord.id}:`, error);
             if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
                  // Record to update not found (e.g., user deleted concurrently?)
                  throw new NotFoundError('User or invitation not found during update.');
             }
             throw new InternalServerError('Failed to link your account to the company.');
        }
    }

}

export const inviteService = new InviteService
