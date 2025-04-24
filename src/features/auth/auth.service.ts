import { Prisma, User, UserRole, PrismaClient } from '@prisma/client'; // Import PrismaClient type if needed
import { prisma } from '../../lib/prisma'; // Import the getter function
import { RegisterInput, RegisterCompanyInput } from './validate';
import {
	ConflictError,
	InternalServerError,
	NotFoundError,
	ForbiddenError,
	ApiError,
	UnauthorizedError,
} from '../../utils/ApiError';
import logger from '../../config/logger';
import { emailService } from '../../emails/email.service';
import { authUtils } from '../../utils/auth.utils';
import { userService } from '../user/user.service';

const SAFE_USER_SELECT = {
	id: true,
	email: true,
	role: true,
	companyId: true,
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

	// Check for Conflicts (Company email/name, Admin email)
	const [existingCompany, existingUser] = await Promise.all([
		prisma.company.findFirst({
			where: { OR: [{ email: lowerCaseCompanyEmail }, { name: data.companyName }] },
			select: { id: true },
		}),
		userService.findUserByEmailInternal(lowerCaseCompanyEmail),
	]);

	if (existingCompany) {
		throw new ConflictError('A company with this name or email already exists.');
	}
	if (existingUser) {
		throw new ConflictError('An account with this admin email already exists.');
	}

	// 2. Hash Password
	const hashedPassword = await authUtils.hashPassword(data.adminPassword);

	// 3. Database Transaction
	logger.info(
		`Starting company registration for ${data.companyName}, admin ${lowerCaseCompanyEmail}`
	);
	try {
		const newAdminUser = await prisma.$transaction(async (tx) => {
			// Create Company
			const newCompany = await tx.company.create({
				data: {
					name: data.companyName,
					email: lowerCaseCompanyEmail,
				},
			});
			logger.info(`Company ${newCompany.id} created: ${newCompany.name}`);

			// Create User (initial ADMIN)
			const createdUser = await tx.user.create({
				data: {
					email: lowerCaseCompanyEmail,
					password: hashedPassword,
					role: UserRole.ADMIN,
					companyId: newCompany.id,
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
			await emailService.sendVerificationEmail(newAdminUser.email, verificationToken);
			logger.info(
				{ userId: newAdminUser.id, email: newAdminUser.email },
				'Verification email triggered successfully for new admin'
			);
		} catch (emailError) {
			logger.error(
				{ err: emailError, userId: newAdminUser.id },
				'Failed to send verification email after company/admin registration.'
			);
			// Don't throw here, user exists, they can request resend. Maybe add flag?
			// Consider how to alert the user or support team about this failure.
		}

		logger.info(
			`Company ${newAdminUser.companyId} and Admin ${newAdminUser.id} registration successful (pending verification).`
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
const registerUser = async (data: RegisterInput): Promise<Omit<User, 'password'>> => {
	const { email, password } = data;

	const existingUser = await userService.findUserByEmailInternal(email);

	if (existingUser) {
		throw new ConflictError('An account with this email already exists.');
	}

	const hashedPassword = await authUtils.hashPassword(password);

	let user: Omit<User, 'password'>;

	try {
		user = await prisma.user.create({
			data: {
				email,
				password: hashedPassword,
			},
			select: SAFE_USER_SELECT,
		});
	} catch (error) {
		if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
			throw new ConflictError('An account with this email already exists.');
		}
		logger.error({ err: error }, 'Error during user creation');
		throw new ApiError(500, 'Failed to create user due to an unexpected error.');
	}

	try {
		const verificationToken = authUtils.generateEmailVerificationToken(user.id, user.email);
		await emailService.sendVerificationEmail(user.email, verificationToken);

		logger.info(
			{ userId: user.id, email: user.email },
			'Verification email triggered successfully'
		);
	} catch (emailError) {
		logger.error({ err: emailError }, 'Failed to send verification email after registration.');
		throw new InternalServerError(
			'Registration succeeded, but failed to send verification email. Please try resending verification later.'
		);
	}

	return user;
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
			await emailService.sendWelcomeEmail(updatedUser.email);
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
		await emailService.sendVerificationEmail(user.email, verificationToken);
		logger.info({ userId: user.id }, 'Resent verification email successfully');
	} catch (error) {
		logger.error({ err: error, userId: user.id }, 'Failed to resend verification email.');
		throw new InternalServerError('Failed to resend verification email.');
	}
};

/**
 * Logs in a user by verifying their email and password.
 */
const loginUser = async (
	email: string,
	password: string
): Promise<{ user: Omit<User, 'password'>; accessToken: string }> => {
	const user = await userService.findUserByEmailInternal(email);

	if (!user) {
		throw new UnauthorizedError('Invalid email or password.');
	}

	const isPasswordValid = await authUtils.verifyPassword(password, user.password);

	if (!isPasswordValid) {
		throw new UnauthorizedError('Invalid email or password.');
	}

	if (!user.isVerified) {
		logger.warn({ userId: user.id }, 'Login attempt by unverified user');
		throw new ForbiddenError(
			'Your email address is not verified. Please check your email or request a new verification link.'
		);
	}

	const accessToken = authUtils.generateAccessToken({
		id: user.id,
		role: user.role,
		email: user.email,
		isVerified: user.isVerified,
		companyId: user.companyId,
	});

	delete user.password;

	return {
		user,
		accessToken,
	};
};

export const authService = {
	registerCompanyAndAdmin,
	registerUser,
	verifyEmailTokenAndVerifyUser,
	resendVerificationEmail,
	loginUser,
};
