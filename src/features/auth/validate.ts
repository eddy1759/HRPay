import { z } from 'zod';
import { EmployeeUserRole } from '@prisma/client';

// Schema for user registration
export const RegisterSchema = z.object({
	body: z.object({
		email: z.string({ required_error: 'Email is required' }).email('Invalid email format'),
		firstName: z.string({ required_error: 'First name is required' }),
		lastName: z.string({ required_error: 'Last name is required' }),
		companyId: z.string({ required_error: 'Company ID is required' }),
		role: z.enum([EmployeeUserRole.ADMIN, EmployeeUserRole.EMPLOYEE]).optional(),
		password: z
			.string({ required_error: 'Password is required' })
			.min(8, 'Password must be at least 8 characters long'),
		passwordConfirmation: z.string().min(8, { message: "Admin password must be at least 8 characters" }),
	}).refine((data) => data.password === data.passwordConfirmation, {
		message: "Passwords don't match",
		path: ["body", "passwordConfirmation"], 
  	}),
});

// Schema for user login
export const LoginSchema = z.object({
	body: z.object({
		email: z.string({ required_error: 'Email is required' }).email('Invalid email format'),
		password: z.string({ required_error: 'Password is required' }),
		companyId: z.string().optional(),
	}),
});

// ResendVerificationSchema
export const ResendVerificationSchema = z.object({
	body: z.object({
		email: z.string({ required_error: 'Email is required' }).email('Invalid email format'),
	}),
});

export const RegisterCompanySchema = z.object({
	body: z.object({
		companyName: z.string().min(2, { message: "Company name must be at least 2 characters" }),
		companyEmail: z.string().email({ message: "Invalid company contact email" }),
		adminFirstName: z.string().min(1, { message: "Admin first name is required" }),
		adminLastName: z.string().min(1, { message: "Admin last name is required" }),
		adminPassword: z.string().min(8, { message: "Admin password must be at least 8 characters" }),
	  	passwordConfirmation: z.string().min(8, { message: "Admin password must be at least 8 characters" }),
	}).refine((data) => data.adminPassword === data.passwordConfirmation, {
		  message: "Passwords don't match",
		  path: ["body", "passwordConfirmation"], // path of error
	}),
});
  

  
  

// Extract TypeScript types from Zod schemas
export type RegisterInput = z.infer<typeof RegisterSchema>['body'];
export type LoginInput = z.infer<typeof LoginSchema>['body'];
export type ResendVerificationInput = z.infer<typeof ResendVerificationSchema>['body'];
export type RegisterCompanyInput = z.infer<typeof RegisterCompanySchema>['body'];
