import { User, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { authUtils } from '@/utils/auth.utils';

const SAFE_USER_SELECT = {
	id: true,
	email: true,
	role: true,
	companyId: true,
	isVerified: true, // Include verification status
	createdAt: true,
	updatedAt: true,
};

type CreateUserInput = {
	email: string;
	password: string;
};

type UpdateUserInput = Partial<{
	email: string;
	firstName: string;
	lastName: string;
}>;

type UpdateUserInputInternal = Partial<{
	isVerified: boolean;
}>;

const createUser = async (data: CreateUserInput) => {
	const hashed = await authUtils.hashPassword(data.password);
	const user = await prisma.user.create({
		data: {
			...data,
			password: hashed,
		},
		select: SAFE_USER_SELECT,
	});

	return user;
};

const findUserByEmailInternal = async (email: string): Promise<User | null> => {
	return prisma.user.findUnique({
		where: { email },
	});
};

const findUserById = async <Select extends Prisma.UserSelect>(
	id: string,
	select?: Select
): Promise<Prisma.UserGetPayload<{ select: Select }> | null> => {
	const user = await prisma.user.findUnique({
		where: { id },
		select: select ?? undefined,
	});
	return user as Prisma.UserGetPayload<{ select: Select }> | null;
};

const updateUser = async (id: string, data: UpdateUserInput) => {
	const user = await prisma.user.update({
		where: { id },
		data,
		select: SAFE_USER_SELECT,
	});
	return user;
};

const getUserByEmail = async (email: string): Promise<User> => {
	const user = await prisma.user.findUnique({
		where: { email },
	});

	return user;
};

const updateUserInternal = async (id: string, data: UpdateUserInputInternal) => {
	const user = await prisma.user.update({
		where: { id },
		data,
		select: SAFE_USER_SELECT,
	});
	return user;
};

export const userService = {
	createUser,
	findUserByEmailInternal,
	findUserById,
	updateUser,
	getUserByEmail,
	updateUserInternal,
};
