import { Prisma, User, SystemUserRole, EmployeeUserRole, Employee, PrismaClient, PayType, EmploymentType } from '@prisma/client'; 
import { StatusCodes } from 'http-status-codes';
import { prisma } from '../../lib/prisma'; // Import the getter function
import { RegisterInput, RegisterCompanyInput, LoginInput } from './validate';
import {
	ConflictError,
	InternalServerError,
	NotFoundError,
	ForbiddenError,
	ApiError,
	UnauthorizedError,
	MultiCompanyLoginRequiredError
} from '../../utils/ApiError';
import logger from '../../config/logger';
import { EmailJobPayload } from '../jobs/emailJob.processor';
import { amqpWrapper } from '../../lib/amqplib';
import { authUtils } from '../../utils/auth.utils';
import { userService } from '../user/user.service';

const SAFE_USER_SELECT = {
	id: true,
	email: true,
	systemRole: true,
	isVerified: true, // Include verification status
	createdAt: true,
	updatedAt: true,
};

/**
 * Registers a new Company and its initial Admin User.
 * Creates Company, User (ADMIN), and Employee records within a transaction.
 * Triggers email verification for the new admin user.
 */
const registerCompanyAndAdmin = async (
	data: RegisterCompanyInput
): Promise<Omit<User, 'password'>> => {

	const lowerCaseCompanyEmail = data.companyEmail.toLowerCase();

	const hashedPassword = await authUtils.hashPassword(data.adminPassword);


	let newAdminUser: Omit<User, 'password'>;

	try {
		newAdminUser = await prisma.$transaction(async (tx) => {

			const existingCompany = await tx.company.findUnique({
				where: { name: data.companyName }, // Check by name
				select: { id: true },
		   });

		   if (existingCompany) {
				logger.warn({ companyName: data.companyName }, 'Company registration conflict: Company name already exists.');
				throw new ConflictError(`A company with the name "${data.companyName}" already exists.`);
		   }

			const existingCompanyEmail = await tx.company.findUnique({
				where: { email: lowerCaseCompanyEmail }, // Check by email
				select: { id: true },
		   });

		   if (existingCompanyEmail) {
				logger.warn({ companyEmail: lowerCaseCompanyEmail }, 'Company registration conflict: Company email already exists.');
				throw new ConflictError(`A company with the email "${data.companyEmail}" already exists.`);
		   }


		   const existingAdminUser = await tx.user.findUnique({
				where: { email: lowerCaseCompanyEmail }, // Check if a user with this email already exists
				select: { id: true },
		   });

		   if (existingAdminUser) {
				logger.warn({ adminEmail: lowerCaseCompanyEmail }, 'Company registration conflict: Admin user email already exists.');
				throw new ConflictError('An admin user with this email already exists.');
		   }

			// Create Company
			const newCompany = await tx.company.create({
				data: {
					name: data.companyName,
					email: lowerCaseCompanyEmail,
					isDeleted: false,
				},
			});
			logger.info(`Company ${newCompany.id} created: ${newCompany.name}`);

			// Create User (initial ADMIN)
			const createdUser = await tx.user.create({
				data: {
					email: lowerCaseCompanyEmail,
					password: hashedPassword,
					systemRole: SystemUserRole.BASIC_USER,
					isVerified: false,
				},
			});
			logger.info(`Admin User ${createdUser.id} created for company ${newCompany.id}`);

			// Create Employee record for the admin user
			await tx.employee.create({
				data: {
					firstName: data.adminFirstName,
					lastName: data.adminLastName,
					email: lowerCaseCompanyEmail, // Match user email for consistency
					companyId: newCompany.id, // Link to company
					userId: createdUser.id, // Link to user
					role: EmployeeUserRole.ADMIN, // Set role as ADMIN
					isActive: true,
                    isDeleted: false,
					employmentType: EmploymentType.FULL_TIME,
					payType: PayType.SALARY
				},
			});
			logger.info(`Employee record created for admin user ${createdUser.id}`);

			// Return created user without password for verification step
			// Fetch again with select to ensure password isn't included
			return tx.user.findUniqueOrThrow({
				where: { id: createdUser.id },
				select: SAFE_USER_SELECT,
			});
		});

		try {
			const verificationToken = authUtils.generateEmailVerificationToken(
				newAdminUser.id,
				newAdminUser.email
			);

			const emailJobPayload: EmailJobPayload = {
				type: 'verification',
				to: newAdminUser.email,
				token: verificationToken,
				name: `${data.adminFirstName} ${data.adminLastName}`
			}
			
			const published = await amqpWrapper.publishMessage(
				'email_job_queue', emailJobPayload
			);
			if (!published) {
				logger.error(
					`Failed to publish email job for verification to ${newAdminUser.email}.`
				);
				
			} else {
				logger.info(
					`Invitation email job successfully queued for ${newAdminUser.email} (Job ID: ${emailJobPayload.type}).`
				);
			}
		} catch (emailError) {
			logger.error(
				{ err: emailError, userId: newAdminUser.id },
				'Failed to send verification email after company/admin registration.'
			);
		}

		logger.info(
			`${data.companyName} Company and Admin ${newAdminUser.id} registration successful (pending verification).`
		);
		return newAdminUser; // Return user data (without password)
	} catch (error) {
		logger.error(
			`Company registration transaction failed for company ${data.companyName}, admin ${lowerCaseCompanyEmail}:`,
			error
		);
		if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
			// This might happen if checks fail due to race conditions
			throw new ConflictError(
				'Registration failed: Duplicate company or admin email detected.'
			);
		}
		if (error instanceof ApiError) throw error; // Re-throw known API errors
		throw new InternalServerError('Failed to register company due to a database error.');
	}
};


/**
 * Register a new user.
 * Checks existing email, hashes password, creates user, generates verification token,
 * and triggers sending the verification email.
 */
const createUser = async (data: RegisterInput): Promise<Omit<User, 'password'>> => {
	const { email, firstName, lastName, password, companyId, role } = data;


	let newUser: Omit<User, 'password'>;		

	try {
		newUser = await prisma.$transaction(async (tx) => {
			// Check for existing user
			const existingUser = await tx.user.findUnique({
				where: { email },
				select: { id: true },
			});
			if (existingUser) throw new ConflictError('An account with this email already exists.');

			const hashedPassword = await authUtils.hashPassword(password);
		
			// Create new user
			const createdUser = await tx.user.create({
				data: {
					email,
					password: hashedPassword,
					isVerified: true,
					systemRole: SystemUserRole.BASIC_USER,
				},
				select: SAFE_USER_SELECT,
			});

			// Create employee record
			await tx.employee.create({
				data: {
					firstName,
					lastName,
					email,
					isActive: true,
                    isDeleted: false,
					role: role || EmployeeUserRole.EMPLOYEE,
					companyId: companyId,
					userId: createdUser.id,
				},
			});

			return createdUser;
		})
		
	} catch (error) {
		if (error instanceof ConflictError) throw error;
		if (error instanceof ApiError) throw error;
	   
	   if (error instanceof Prisma.PrismaClientKnownRequestError) {
			logger.error({ err: error, code: error.code }, 'Prisma error during user/employee creation transaction');
			throw new ApiError(500, 'Database error during registration.'); 
	   }
	   logger.error({ err: error }, 'Unexpected error during user registration transaction');
	   throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'Failed to create user due to an unexpected error.');
	}
	return newUser;
};

/**
 * Verifies an email verification token and updates the user's status.
 */
const verifyEmailTokenAndVerifyUser = async (token: string): Promise<Omit<User, 'password'>> => {
	let userId: string;

	const decoded = authUtils.verifyEmailVerficiationToken(token);
	userId = decoded.id;

	const user = await userService.findUserById(userId, SAFE_USER_SELECT);

	if (!user) {
		throw new NotFoundError('User associated with this token not found.');
	}

	if (user.isVerified) {
		throw new ConflictError('User is already verified.');
	}

	try {
		const data = { isVerified: true };
		const updatedUser = await userService.updateUserInternal(userId, data);

		if (!updatedUser) {
			throw new NotFoundError('User not found.');
		}
		if (updatedUser.isVerified) {
			const emailJobPayload: EmailJobPayload = {
				type: 'welcome',
				to: updatedUser.email,
			};
			const published = await amqpWrapper.publishMessage(
				'email_job_queue', emailJobPayload
			);
			if (!published) {
				logger.error(
					`Failed to publish email job for welcome to ${updatedUser.email}.`
				);
				
			}
			logger.info(
				`Welcome email job successfully queued for ${updatedUser.email} (Job ID: ${emailJobPayload.type}).`
			);
		}
		logger.info({ userId: updatedUser.id }, 'User email verified successfully.');
		return updatedUser;
	} catch (error) {
		logger.error({ err: error, userId }, 'Error updating user verification status.');
		if (error instanceof ApiError) {
			throw error;
		}
		throw new InternalServerError('Failed to update verification status.');
	}
};

/**
 * Resends the verification email to the user.
 */
export const resendVerificationEmail = async (email: string): Promise<string | void> => {
	const user = await userService.findUserByEmailInternal(email);

	if (!user) {
		throw new NotFoundError('User not found.');
	}
	if (user.isVerified) {
		throw new ConflictError('Account already verified.');
	}

	try {
		const verificationToken = authUtils.generateEmailVerificationToken(user.id, user.email);
		const emailJobPayload: EmailJobPayload = {
			type: 'verification',
			to: user.email,
			token: verificationToken,
		}
		
		const published = await amqpWrapper.publishMessage(
			'email_job_queue', emailJobPayload
		);
		if (!published) {
			logger.error(
				`Failed to publish email job for verification to ${user.email}.`
			);
			
		} else {
			logger.info(
				`Invitation email job successfully queued for ${user.email} (Job ID: ${emailJobPayload.type}).`
			);
		}
	} catch (error) {
		logger.error({ err: error, userId: user.id }, 'Failed to resend verification email.');
		throw new InternalServerError('Failed to resend verification email.');
	}
};

/**
 * Logs in a user by verifying their email and password.
 */
const loginUser = async (
	data: LoginInput
): Promise<{ user: Omit<User, 'password'>; accessToken: string; refreshToken: string }> => {
	const { email, password, companyId } = data;

	const user = await prisma.user.findUnique({
        where: { email },
        include: {
            employees: {
                where: {
                    isActive: true,
                    isDeleted: false,
                },
                include: { // Include Company relation to get company name
                    company: {
                        select: {
                            id: true,
                            name: true,
                        }
                    }
                }
            }
        }
    });

	if (!user) {
		throw new UnauthorizedError('Invalid Credentials.');
	}

	
	if (!await authUtils.verifyPassword(password, user.password)) {
		throw new UnauthorizedError('Invalid Credentials.');
	}

	if (!user.isVerified) {
		logger.warn({ userId: user.id }, 'Login attempt by unverified user');
		throw new ForbiddenError(
			'Your email address is not verified. Please check your email or request a new verification link.'
		);
	}

	let selectedEmployee: (Employee & { company: { id: string; name: string; } }) | null = null;
	if (companyId) {
		selectedEmployee = user.employees.find(emp => emp.companyId === companyId) || null;

		if (!selectedEmployee) {
			logger.warn({ userId: user.id, companyId }, 'Login failed: User does not belong to the specified company.');
			throw new UnauthorizedError('Invalid Credentials.');
		}
	} else {
		const activeEmployees = user.employees;
		if (activeEmployees.length === 0) {
			throw new UnauthorizedError('User account has no active company affiliations.');
		} else if (activeEmployees.length === 1) {
			selectedEmployee = activeEmployees[0];
		} else {
			logger.warn({ userId: user.id, numCompanies: activeEmployees.length }, 'Login failed: User belongs to multiple companies, companyId is required.');

			// Extract company details (ID and Name) to return to the frontend
			const companiesList = activeEmployees.map(emp => ({
				id: emp.company.id,
				name: emp.company.name,
			}));

			throw new MultiCompanyLoginRequiredError('You belong to multiple companies. Please specify the company ID to log in.', companiesList);
		}
	}

	const companyIdForToken = selectedEmployee?.companyId || null;
	const employeeRoleForToken = selectedEmployee?.role || null;


	const accessToken = authUtils.generateAccessToken(
		user,
		companyIdForToken,
		employeeRoleForToken,
		user.isVerified,
	);

	const refreshToken = authUtils.generateRefreshToken();
    await authUtils.storeRefreshToken(user.id, refreshToken); // Store the refresh token in Redis

	const userWithoutPassword = { ...user };
    delete userWithoutPassword.password;
    // Also remove the employees relation from the returned user object if not needed by the frontend
    delete (userWithoutPassword as any).employees;

	return {
		user: userWithoutPassword,
        accessToken,
        refreshToken,
	};
};



// --- Refresh Token Endpoint Handler ---
/**
 * Handles refresh token requests to issue new access and refresh tokens.
 * This would be a separate API endpoint (e.g., POST /auth/refresh-token).
 * It can optionally accept a companyId to switch context during refresh.
 */
const refreshTokenHandler = async (refreshToken: string, companyId: string) => {
   
    if (!refreshToken) {
        throw new UnauthorizedError('Refresh token is required.');
    }

    try {
        
        const isRevoked = await authUtils.isRefreshTokenRevoked(refreshToken);
        if (isRevoked) {
             logger.warn({ refreshToken }, 'Refresh token handler failed: Token has been revoked.');
             throw new UnauthorizedError('Invalid or revoked refresh token.');
        }

        // Get user ID associated with the refresh token from Redis
        const userId = await authUtils.getUserIdFromRefreshToken(refreshToken);

        if (!userId) {
            // If token is not found in Redis, it's invalid or expired
            throw new UnauthorizedError('Invalid or expired refresh token.');
        }

        await authUtils.revokeRefreshToken(refreshToken);
		logger.debug({ userId }, 'Used refresh token revoked.');

        const user = await prisma.user.findUnique({
             where: { id: userId },
             include: {
                 employees: {
                     where: {
                         isActive: true,
                         isDeleted: false,
                     },
                     include: { // Include Company relation to get company name if needed
                         company: {
                             select: {
                                 id: true,
                                 name: true,
                             }
                         }
                     }
                 }
             }
        });

		if (!user || !user.employees.some(emp => emp.isActive && !emp.isDeleted)) {
             logger.warn({ userId }, 'Refresh token handler failed: User account is inactive or deleted.');
             throw new UnauthorizedError('User account is inactive or deleted.');
        }

        let selectedEmployee: (Employee & { company: { id: string; name: string; } }) | null = null;

        if (companyId) {
             // User specified a company for the new token, find that employee record
             selectedEmployee = user.employees.find(emp => emp.companyId === companyId) || null;

             if (!selectedEmployee) {
                 // Employee record not found for the specified company or is inactive/deleted
                 logger.warn({ userId: user.id, companyId }, 'Refresh failed: User is not an active employee of the specified company for token renewal.');
                 throw new UnauthorizedError('Invalid company specified for token refresh.');
             }
        } else {
             selectedEmployee = user.employees[0] || null; // Default to the first active employee

             if (!selectedEmployee) {
                  // Should not happen if user has active employee records, but defensive check
                  logger.warn({ userId: user.id }, 'Refresh failed: Could not determine employee record for token renewal.');
                  throw new UnauthorizedError('Could not determine company affiliation for token refresh.');
             }
        }

        const companyIdForNewToken = selectedEmployee?.companyId || null;
        const employeeRoleForNewToken = selectedEmployee?.role || null;


        // --- Generate New Access and Refresh Tokens ---
        const newAccessToken = authUtils.generateAccessToken(
            user,
           companyIdForNewToken,
            employeeRoleForNewToken,
           user.isVerified,
        );

        const newRefreshToken = authUtils.generateRefreshToken();
        await authUtils.storeRefreshToken(user.id, newRefreshToken); // Store the new refresh token in Redis

        // Remove password before returning user object
        const userWithoutPassword = { ...user };
        delete userWithoutPassword.password;
        // Also remove the employees relation from the returned user object if not needed by the frontend
        delete (userWithoutPassword as any).employees;

		return {
			user: userWithoutPassword,
			accessToken: newAccessToken,
			newRefreshToken,
		};
        
    } catch (error) {
        logger.error({ error }, 'Unexpected error in refreshTokenHandler');
      	throw new InternalServerError('An internal error occurred during token refresh.');
    }
};





export const authService = {
	registerCompanyAndAdmin,
	createUser,
	verifyEmailTokenAndVerifyUser,
	resendVerificationEmail,
	loginUser,
	refreshTokenHandler,
};
