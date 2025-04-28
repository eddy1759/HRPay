import { Prisma, PrismaClient, Invitation, User as PrismaUser, Employee, InviteStatus, SystemUserRole, EmploymentType, PayType, EmployeeUserRole,
} from '@prisma/client';


import logger from '@/config/logger';
import { prisma } from '@/lib/prisma';
import { amqpWrapper } from '@/lib/amqplib';
import { authUtils } from '@/utils/auth.utils';
import { authService } from '../auth/auth.service';
import { emailService } from '@/emails/email.service';
import { EmailJobPayload } from '../jobs/emailJob.processor';
import { inviteUtils, InvitePermissionError } from './invite.utils';
import { ConflictError, InternalServerError, NotFoundError,ForbiddenError, 
			UnauthorizedError, BadRequestError, ApiError
		} from '@/utils/ApiError';
import { InviteJwtPayload, VerifiedInviteData, UserOnboardingData } from './invite.types'; 



// Only ADMIN at company-level can manage invites
const COMPANY_MANAGER_ROLES: EmployeeUserRole[] = [EmployeeUserRole.ADMIN];

export class InviteService {
	constructor(
		private prisma: PrismaClient = prisma,
		private emailer = emailService
	) {}

	
	/**
     * Internal helper to assert if a user has sufficient permissions
     * to manage invitations within a specific company.
     * Checks for active employee status and role within the company.
     * System SUPER_ADMIN is NOT allowed for company-invite actions.
     *
     * @param userId - The ID of the user performing the action.
     * @param companyId - The ID of the company context.
     * @param allowedRoles - Array of employee roles allowed to manage invites.
     * @throws UnauthorizedError if user is not found or not authenticated.
     * @throws ForbiddenError if user is a SUPER_ADMIN or not a member of the company.
     * @throws InvitePermissionError if user's employee role is insufficient.
     * @throws InternalServerError on unexpected errors.
     */
	private async assertCompanyAdmin(
		userId: string,
		companyId: string,
		allowedRoles: EmployeeUserRole[] = COMPANY_MANAGER_ROLES
	) {
		try {
			const user = await this.prisma.user.findUnique({ where: { id: userId }, select: {id: true, systemRole: true} });

			if (!user) throw new NotFoundError('User not found');

			if (user.systemRole === SystemUserRole.SUPER_ADMIN) {
				logger.warn({ userId, systemRole: user.systemRole }, 'Permission check failed: SUPER_ADMIN attempted company-scoped invite action.');
				throw new ForbiddenError('Cannot perform company-scoped invite actions');
			}

			const emp = await this.prisma.employee.findUnique({
				where: { userId_companyId: { userId, companyId } },
				select: { id: true, role: true, isActive: true, isDeleted: true, companyId: true}
			});

			if (!emp) throw new ForbiddenError('Not a member of this company');

			if (!emp.isActive || emp.isDeleted) {
				logger.warn({ userId, companyId, isActive: emp.isActive, isDeleted: emp.isDeleted }, 'Permission check failed: Employee record is inactive or deleted.');
				throw new ForbiddenError('Your employee record in this company is not active.');
			}

			// Employee must have sufficient role
			if (!allowedRoles.includes(emp.role)) {
				throw new InvitePermissionError(`Role ${emp.role} cannot manage invites`);
			}

			return emp;
		
		} catch (error) {
			if (error instanceof ApiError) {
                throw error;
            }
            logger.error({ err: error, userId, companyId }, 'Unexpected error during company admin permission check.');
            throw new InternalServerError('An internal error occurred during permission check.');
		}
	}

	/**
     * Create and dispatch an invitation (company-admin only).
     * Ensures the invitee is not already an active employee in the company
     * and does not have a pending invitation.
     * Uses a transaction for creating the invitation record.
     * Dispatches email asynchronously via queue.
     *
     * @param inviterId - The ID of the user creating the invitation.
     * @param companyId - The ID of the company the invitation is for.
     * @param inviteeEmail - The email address of the person being invited.
     * @param role - The employee role the invitee will have (defaults to EMPLOYEE).
     * @returns A promise resolving to the created Invitation record.
     * @throws ForbiddenError if inviter lacks permissions.
     * @throws NotFoundError if company is not found.
     * @throws ConflictError if user is already an employee or has a pending invite.
     * @throws ApiError derivatives for validation or other issues.
     */
	async createInvitation(
		inviterId: string,
		companyId: string,
		inviteeEmail: string,
		role: EmployeeUserRole = EmployeeUserRole.EMPLOYEE
	): Promise<Invitation> {
		const email = inviteeEmail.toLowerCase();

		// enforce only company ADMINs, not super-admins
		await this.assertCompanyAdmin(inviterId, companyId);

		const [company, existingEmp, exitingPendingInvite] = await Promise.all([
			this.prisma.company.findUnique({ where: { id: companyId }, select: { id: true, name: true, isDeleted: true } }),
			this.prisma.employee.findFirst({ where: { email, companyId } }),
			this.prisma.invitation.findUnique({
				where: { email_companyId_status: { email, companyId, status: InviteStatus.PENDING } },
			}),
		])

		if (!company || company.isDeleted) throw new NotFoundError('Company not found');

		if (existingEmp) throw new ConflictError('User already in company');

		if (exitingPendingInvite) throw new ConflictError('Pending invite already exists for this user');

		const { token, expiresAt } = inviteUtils.generateRandomTokenAndExpiryDate();

		let invite: Invitation;
		try {
			invite = await this.prisma.$transaction(async (tx) => {
				const existingEmpTx = await tx.employee.findFirst({ where: { email, companyId, isDeleted: false } });
                 if (existingEmpTx) throw new ConflictError('User already in company (transaction conflict)');

                 const exitingPendingInviteTx = await tx.invitation.findUnique({
                     where: { email_companyId_status: { email, companyId, status: InviteStatus.PENDING } },
                 });
                 if (exitingPendingInviteTx) throw new ConflictError('Pending invite already exists (transaction conflict)');

				 const createdInvite = await tx.invitation.create({
					data: {
						email,
						role,
						token: token, // Store the random token in DB
						expiresAt,
						companyId,
						invitedById: inviterId,
						status: InviteStatus.PENDING
					},
				});
				logger.info(
                    `Invitation record ${createdInvite.id} created within transaction for ${email}, company ${companyId}.`
                );
				return createdInvite;
			})
		} catch (e: any) {
			if (e.code === 'P2002') throw new ConflictError('Invite already exists');
			logger.error(`Failed to create invitation DB record for ${email}:`, e);
			throw new InternalServerError('Could not create invitation');
		}

		const jwtPayload = {
			email: invite.email,
			dbToken: invite.token,
			companyId: invite.companyId,
		}
		const jwt = await inviteUtils.generateInviteToken(jwtPayload);
		const url = inviteUtils.buildInvitationUrl(jwt);
		// Publish to AMQP queue
		const emailJobPayload: EmailJobPayload = {
			type: 'invite',
			to: email,
			invitationUrl: url,
			companyName: company?.name,
		}
		try {
			const published = await amqpWrapper.publishMessage('email_job_queue', emailJobPayload);
			if (!published) {
				logger.error(
					`NON-CRITICAL: Failed to publish email job for invitation ${invite.id} to ${email}. AMQP publish failed.`
				);
				// Decide on handling: log, alert, maybe a retry mechanism outside this function
			} else {
				logger.info(
					`Invitation email job successfully queued for ${email} (Job Type: ${emailJobPayload.type}).`
				);
			}
	   } catch (emailQueueError) {
			logger.error({ err: emailQueueError, inviteId: invite.id, email }, 'NON-CRITICAL: Failed to publish email job to AMQP.');
	   }
		return invite;
	}



	 /**
     * Verifies an invitation token (JWT and DB state).
     * Returns data including the invitation record, company details,
     * and whether a User account exists for the invitee email.
     *
     * @param token - The JWT received from the invitation link.
     * @returns VerifiedInviteData containing payload, invitationRecord, company, and existence flag.
     * @throws UnauthorizedError if the token is invalid or expired.
     * @throws NotFoundError if the invitation record is not found or company is deleted.
     * @throws BadRequestError if the invitation status is not PENDING or is expired (based on DB expiry).
     * @throws InternalServerError on unexpected errors.
     */
	 async verifyInvitation(token: string): Promise<VerifiedInviteData> {
        try {
            // verifyInviteTokenAndState should check JWT expiry, signature,
            // find the invitation record by email and dbToken, and check invitation status.
            const verifiedData = await inviteUtils.verifyInviteTokenAndState(token);

            // Check if a User account exists with this email globally
            const userAccountExists = await this.prisma.user.findUnique({
                 where: { email: verifiedData.payload.email.toLowerCase() },
                 select: { id: true },
            });

            // Update the return type to reflect checking for User account existence
            const result: VerifiedInviteData = {
                ...verifiedData, // Includes payload, invitationRecord, company
                invitedUserExists: !!userAccountExists, // True if user account exists
            };

            logger.info(
                `Invitation token verified successfully for email ${result.payload.email}. User account exists: ${result.invitedUserExists}.`
            );
            return result;
        } catch (error) {
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
     * Completes onboarding for a *new* user accepting an invitation.
     * Creates a new User account and an Employee record linked to the company in the invite.
     * Marks the invitation as accepted.
     * Uses a database transaction for atomicity.
     * Dispatches a welcome email asynchronously via queue.
     *
     * @param token - The invitation JWT.
     * @param password - The password for the new user account.
     * @param firstName - The first name for the new user and employee record.
     * @param lastName - The last name for the new user and employee record.
     * @returns A promise resolving to the created user object (without password).
     * @throws UnauthorizedError if the token is invalid/expired.
     * @throws ConflictError if a user account already exists with this email.
     * @throws BadRequestError if the invitation is not pending.
     * @throws InternalServerError on database or unexpected errors.
     */
	async completeOnboarding(
		token: string,
		password: string,
		firstName: string,
		lastName: string
	): Promise<Omit <PrismaUser, 'password'>> {
		const verifiedData = await this.verifyInvitation(token);

		if (verifiedData.invitedUserExists) {
			logger.warn(
				`Onboarding attempt failed via 'completeOnboarding': User account ${verifiedData.invitationRecord.email} already exists.`
			);
			throw new ConflictError('An account with this email already exists. Please use the invitation link after logging in.');
		}


		const invitationId = verifiedData.invitationRecord.id;
        const inviteEmail = verifiedData.invitationRecord.email;
        const inviteCompanyId = verifiedData.invitationRecord.companyId;
        const inviteRole = verifiedData.invitationRecord.role;

		let newUser: Omit<PrismaUser, 'password'>;

		try {
			newUser = await this.prisma.$transaction(async (tx) => {
				const createdUser = await authService.createUser({
					email: inviteEmail,
					password,
					firstName,
					lastName,
					companyId: inviteCompanyId,
					role: inviteRole
				});

				await tx.invitation.update({
					where: { id: invitationId },
					data: { status: InviteStatus.ACCEPTED, acceptedByUserId: newUser.id },
					select: { id: true },
				});

				logger.info(`[Transaction] Invitation ${invitationId} status updated to ACCEPTED by user ${createdUser.id}.`);

				return createdUser;
			})
			const companyData = await prisma.company.findUnique({
				where: { id: inviteCompanyId, isDeleted: false },
				select: { name: true }
			});

			if (!companyData) throw new NotFoundError("Company Not Found")

			const emailJobPayload: EmailJobPayload = {
				type: 'welcome',
				to: inviteEmail,
				name: `${firstName} ${lastName}`,
				companyName: companyData?.name || 'Your Company',
			};


			try {
				const published = await amqpWrapper.publishMessage('email_job_queue', emailJobPayload);

				if (!published) {
					logger.error(
						`Failed to publish email job for welcoming user ${emailJobPayload.name} to ${inviteEmail}.`
					);
				} else {
					logger.info(
						`Welcome email job successfully queued for user ${inviteEmail} (Job ID: ${emailJobPayload.type}).`
					);
				}
			} catch (emailQueueError) {
				logger.error({ err: emailQueueError, userId: newUser.id }, 'NON-CRITICAL: Failed to publish welcome email job to AMQP after onboarding.');
			}

			logger.info(
                `Onboarding successfully completed for new user: ${newUser.email} (ID: ${newUser.id}) via invitation ${invitationId}.`
            );

			return newUser;

		} catch (error) {
			logger.error(`Database transaction failed during user onboarding via invite ${invitationId}:`, error);

            if (error instanceof ApiError) {
                 throw error;
            }
            if (error instanceof Prisma.PrismaClientKnownRequestError) {
                logger.error(`Prisma Error Code: ${error.code}, Meta: ${JSON.stringify(error.meta)}`);
                if (error.code === 'P2002') { // Unique constraint violation
                     // Could happen if a race condition created the user/employee just before the transaction
                     throw new ConflictError(
                         'Account creation failed due to a data conflict (e.g., user or employee record already exists).'
                     );
                }
                
            }

            // Catch any other unexpected errors
            logger.error({ err: error }, 'Unexpected error during user onboarding transaction.');
            throw new InternalServerError('Failed to complete account setup.');
		}
	}

	/**
     * Links an existing, authenticated user to the company specified in a valid invitation.
     * Creates an Employee record for the user in that company.
     * Marks the invitation as accepted.
     * This function is for users who ALREADY have a User account.
     * Uses a database transaction for atomicity.
     * Dispatches a welcome email asynchronously via queue.
     *
     * @param token - The invitation JWT.
     * @param loggedInUserId - The ID of the currently authenticated user attempting to accept.
     * @param firstName - The user's first name for the employee record.
     * @param lastName - The user's last name for the employee record.
     * @returns A promise resolving to the updated User object (or the existing one if already linked).
     * @throws UnauthorizedError if the token is invalid/expired or authenticated user not found.
     * @throws ForbiddenError if the logged-in user's email doesn't match the invite email.
     * @throws BadRequestError if the invitation is not pending or already accepted/expired.
     * @throws ConflictError if the user is already an employee of the company.
     * @throws InternalServerError on database or unexpected errors.
     */
	async linkExistingUserToInvite(token: string, loggedInUserId: string, firstName: string, lastName: string) {
		// Verify the invitation token and extract data
		const verifiedData = await this.verifyInvitation(token); // verifyInvitation now checks userAccountExists
		const { invitationRecord, company } = verifiedData;

		// This function is specifically for users who already have an account.
		// If no user account exists, they should use the completeOnboarding flow.
		if (!verifiedData.invitedUserExists) {
			logger.warn(
				`Linking attempt failed via 'linkExistingUserToInvite': No user account found for ${verifiedData.invitationRecord.email}.`
			);
			// Redirect or instruct the user to the correct sign-up flow
			throw new BadRequestError("No existing account found with this email. Please use the invitation link to create a new account.");
		}

		// Verify the logged-in user is the intended recipient
		const loggedInUser = await this.prisma.user.findUnique({
			where: { id: loggedInUserId },
			// Include employees relation to check existing employment easily
			include: { employees: { where: { companyId: invitationRecord.companyId, isDeleted: false } } }
		});

		if (!loggedInUser) {
			throw new UnauthorizedError('Authenticated user not found.'); // Should be caught by auth middleware, but defensive.
		}

		if (loggedInUser.email.toLowerCase() !== invitationRecord.email.toLowerCase()) {
			logger.warn(`User ${loggedInUserId} (${loggedInUser.email}) tried to accept invite for ${invitationRecord.email}.`);
			throw new ForbiddenError('This invitation is intended for a different email address.');
		}

		// Check if user already has an Employee record for THIS specific company
		if (loggedInUser.employees && loggedInUser.employees.length > 0) {
			logger.warn(`User ${loggedInUserId} is already an employee of company ${company.id}. Invite ${invitationRecord.id} may be redundant.`);

			return loggedInUser.employees; // Return the user, linking wasn't needed
		}

		// If we reach here, the user exists, email matches, and they are NOT
		// already an employee of the company in the invitation.

		let newEmployee: Employee;
		try {
			// Initiate the transaction
			newEmployee = await this.prisma.$transaction(async (prisma) => {
				// 1. Update Invitation status to ACCEPTED
				await prisma.invitation.update({
					where: { id: invitationRecord.id },
					data: { status: InviteStatus.ACCEPTED, acceptedByUserId: loggedInUserId },
					select: { id: true }
				});
				logger.info(`[Transaction] Invitation ${invitationRecord.id} marked as ACCEPTED by user ${loggedInUserId}.`);

				// 2. Create the Employee record for this company, linking to the existing User
				const newEmp = await prisma.employee.create({
					data: {
						firstName: firstName, // Use provided names
						lastName: lastName,   // Use provided names
						email: loggedInUser.email, // Employee email matches user email
						companyId: company.id, // Link to company
						userId: loggedInUserId, // Link to the existing user
						role: invitationRecord.role || EmployeeUserRole.EMPLOYEE, // Use role from invitation
						isActive: true,
						isDeleted: false,
						employmentType: EmploymentType.FULL_TIME,
						payType: PayType.SALARY
						// Add other required Employee fields
					},
				});
				logger.info(`[Transaction] Employee record created and linked for User ${loggedInUserId} at Company ${company.id}.`);
				return newEmp
			});

			// Transaction committed successfully. Fetch the updated user and publish email.
			const updatedUser = await this.prisma.user.findUnique({ where: { id: loggedInUserId } });

			// Publish welcome email job
			const emailJobPayload: EmailJobPayload = {
				type: 'welcome',
				to: loggedInUser.email,
				name: `${firstName} ${lastName}`, // Use names provided for employee record
				companyName: company.name, // Use company name from verifiedData
			};

			try {
                const published = await amqpWrapper.publishMessage(
                    'email_job_queue',
                    emailJobPayload
                );

                if (!published) {
                    logger.error(
                        `NON-CRITICAL: Failed to publish welcome email job for user ${emailJobPayload.name} to ${emailJobPayload.to}.`
                    );
                    // Decide on handling: log, alert, retry
                } else {
                    logger.info(
                        `NON-CRITICAL: Welcome email job successfully queued for user ${emailJobPayload.to} (Job Type: ${emailJobPayload.type}).`
                    );
                }
            } catch (emailQueueError) {
                 logger.error({ err: emailQueueError, userId: loggedInUserId }, 'NON-CRITICAL: Failed to publish welcome email job to AMQP after linking.');
                 // Log the error, but don't fail the linking process.
            }

			// Always return the successfully updated user object
			if (!updatedUser) {
				// This case should be impossible if the transaction succeeded and loggedInUser was found initially
				logger.error(`CRITICAL: User ${loggedInUserId} not found after successful linking transaction.`);
				throw new InternalServerError('Failed to retrieve user details after linking.');
			}
			return newEmployee;

		} catch (error: any) {
			logger.error(`Database transaction failed while trying to link user ${loggedInUserId} to company ${company.id} via invite ${invitationRecord.id}:`, error);

			if (error instanceof Prisma.PrismaClientKnownRequestError) {
				logger.error(`Prisma Error Code: ${error.code}, Meta: ${JSON.stringify(error.meta)}`);
				if (error.code === 'P2002') { // Unique constraint violation
					// Could happen if a race condition somehow created the Employee record just before the transaction
					throw new ConflictError(
						'Failed to link account due to a data conflict (e.g., employee record for this company was just created).'
					);
				}
				if (error.code === 'P2025') { // Record to update not found
					throw new NotFoundError('User or invitation not found during database update.');
				}
			}

			if (error instanceof ApiError) {
				throw error;
			}

			throw new InternalServerError('Failed to link your account to the company.');
		}
	}
	
	
	 /**
     * Resends a pending invitation. Regenerates tokens and sends a new email.
     * Requires company admin permissions.
     *
     * @param invitationId - The ID of the invitation to resend.
     * @param resenderId - The ID of the user resending the invite.
     * @returns A promise that resolves when the invitation is updated and email is queued.
     * @throws NotFoundError if the invitation is not found.
     * @throws BadRequestError if the invitation status is not PENDING.
     * @throws ForbiddenError if resender lacks permissions.
     * @throws InternalServerError on database or unexpected errors.
     */
	async resendInvitation(invitationId: string, resenderId: string): Promise<void> {
		// Find invitation and verify resender permissions
		const invitation = await this.prisma.invitation.findUnique({
			where: { id: invitationId },
			include: { company: { select: { id: true, name: true, isDeleted: true } } },
		});

		if (!invitation) throw new NotFoundError('Invitation not found.');
		if (!invitation.company || invitation.company.isDeleted)
			throw new NotFoundError('The company associated with this invitation is no longer active.');
		if (invitation.status !== InviteStatus.PENDING) {
			throw new BadRequestError('Only PENDING invitations can be resent.');
		}

		// Check permissions using helper (checks employee role in the company)
		await this.assertCompanyAdmin(resenderId, invitation.companyId);

		// Regenerate DB token and expiry date
		const { token: newDbToken, expiresAt: newExpiresAt } =
			inviteUtils.generateRandomTokenAndExpiryDate();

		// Update the invitation record with the new token and expiry
		try {
			await this.prisma.invitation.update({
				where: { id: invitationId },
				data: {
					token: newDbToken,
					expiresAt: newExpiresAt,
					status: InviteStatus.PENDING // Ensure it's still pending
				},
				select: { id: true },
			});
			logger.info(`Updated DB token/expiry for invitation ${invitationId}.`);
		} catch (error) {
			logger.error(`Failed to update DB token for resend, invite ${invitationId}:`, error);
			throw new InternalServerError('Failed to refresh invitation details.');
		}

		// Generate a new JWT using the new DB token
		const jwtPayload = {
			email: invitation.email,
			dbToken: newDbToken,
			companyId: invitation.companyId,
		};
		const newEmailJwt = await inviteUtils.generateInviteToken(jwtPayload);
		const newInvitationUrl = inviteUtils.buildInvitationUrl(newEmailJwt);

		// Publish Email Job
		const emailJobPayload: EmailJobPayload = {
			type: 'invite',
			to: invitation.email,
			invitationUrl: newInvitationUrl,
			companyName: invitation.company.name,
		};

		try {
			const published = await amqpWrapper.publishMessage('email_job_queue', emailJobPayload);

			if (!published) {
				logger.error(
					`NON-CRITICAL: Failed to publish email job for invitation ${invitation.id} to ${invitation.email}.`
				);
				// Decide if this is critical - generally not, as the DB is updated.
			} else {
				logger.info(
					`Invitation email job successfully queued for ${invitation.email} (Job Type: ${emailJobPayload.type}). Invitation ID: ${invitation.id}.`
				);
			}
		} catch (emailQueueError) {
				logger.error({ err: emailQueueError, inviteId: invitation.id, email: invitation.email }, 'NON-CRITICAL: Failed to publish resend email job to AMQP.');
		}
	}
	
	/**
     * Cancels a pending invitation by setting its status to CANCELLED.
     * Requires company admin permissions.
     *
     * @param invitationId - The ID of the invitation to cancel.
     * @param cancellerId - The ID of the user cancelling the invite.
     * @returns A promise that resolves when the invitation is cancelled.
     * @throws NotFoundError if the invitation is not found.
     * @throws BadRequestError if the invitation status is not PENDING.
     * @throws ForbiddenError if canceller lacks permissions.
     * @throws InternalServerError on database or unexpected errors.
     */
	async cancelInvitation(invitationId: string, cancellerId: string): Promise<void> {
		// Find invitation and check status
		const invitation = await this.prisma.invitation.findUnique({
			where: { id: invitationId },
			select: { id: true, status: true, companyId: true },
		});

		if (!invitation) throw new NotFoundError('Invitation not found.');
		if (invitation.status !== InviteStatus.PENDING) {
			throw new BadRequestError('Only PENDING invitations can be cancelled.');
		}

		// Verify canceller permissions (checks employee role in the company)
		await this.assertCompanyAdmin(cancellerId, invitation.companyId);

		// Update status to CANCELLED
		try {
			await this.prisma.invitation.update({
				where: { id: invitationId },
				data: { status: InviteStatus.CANCELLED },
				select: { id: true },
			});
			logger.info(`Invitation ${invitationId} cancelled by user ${cancellerId}.`);
		} catch (error) {
			logger.error(`Failed to cancel invitation ${invitationId}:`, error);
			if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
				throw new NotFoundError('Invitation not found during update.');
			}
			throw new InternalServerError('Failed to update invitation status.');
		}
	}
	
	/**
     * Lists invitations for a specific company, optionally filtered by status.
     * Requires company admin permissions.
     * Includes pagination.
     *
     * @param companyId - The company ID whose invitations to list.
     * @param requesterId - The ID of the user requesting the list.
     * @param status - Optional filter by invitation status.
     * @param page - Pagination page number (defaults to 1).
     * @param limit - Pagination limit per page (defaults to 10).
     * @returns An object containing the list of invitations and the total count.
     * @throws ForbiddenError if requester lacks permissions.
     * @throws InternalServerError on database or unexpected errors.
     */
	async listInvitations(
		companyId: string,
		requesterId: string,
		status?: InviteStatus,
		page: number = 1,
		limit: number = 10
	): Promise<{ invites: Invitation[]; total: number }> {
		try {
			// Ensure page and limit are positive integers
            const validatedPage = Math.max(1, Math.floor(page));
            const validatedLimit = Math.max(1, Math.floor(limit));
            const skip = (validatedPage - 1) * validatedLimit;

			// Verify requester permissions (checks employee role in the company)
			await this.assertCompanyAdmin(requesterId, companyId);

			const whereClause: Prisma.InvitationWhereInput = {
				companyId,
				...(status && { status }),
			};

			const [invites, total] = await Promise.all([
				prisma.invitation.findMany({
					where: whereClause,
					skip,
					take: validatedLimit,
					orderBy: {
						createdAt: 'desc'
					},
					// Potentially include invitedByUser if displaying inviter name
					include: { invitedByUser: { select: { id: true, email: true } } } // Select minimal user data
				}),
				prisma.invitation.count({
					where: whereClause,
				})
			]);

			return { invites, total };
		} catch (error) {
			logger.error(`Failed to list invitations for company ${companyId}:`, error);
			if (error instanceof ApiError) {
				throw error; // Rethrow specific errors from validate permissions
			}
			throw new InternalServerError('Failed to retrieve invitations.');
		}
	}
	
}
	
	export const inviteService = new InviteService();




