import { z } from 'zod';
import { EmploymentType, PayType, UserRole } from '@prisma/client';

// Base schema for common fields
const employeeBaseSchema = z.object({
  firstName: z.string().min(1, 'First name is required').max(100),
  lastName: z.string().min(1, 'Last name is required').max(100),
  email: z.string().email('Invalid email address').max(255),
  employmentType: z.nativeEnum(EmploymentType).default(EmploymentType.FULL_TIME),
  payType: z.nativeEnum(PayType).default(PayType.SALARY),
  salary: z.number().positive().optional().nullable(), 
  payRate: z.number().positive().optional().nullable(), 
  userId: z.string().uuid().optional().nullable(),
});


// Schema for creating a new employee
export const createEmployeeSchema = z.object({
  body: employeeBaseSchema.refine(data => {
    if (data.payType === PayType.SALARY && (data.salary === null || data.salary === undefined)) {
      return false; // Salary is required if payType is SALARY
    }
    if (data.payType === PayType.HOURLY && (data.payRate === null || data.payRate === undefined)) {
      return false; // PayRate is required if payType is HOURLY
    }
    return true;
  }, {
    message: 'Salary must be provided for SALARY pay type, and Pay Rate must be provided for HOURLY pay type.',
    path: ['salary', 'payRate'], // Indicate which fields are involved
  }),
});


// Schema for updating an existing employee (all fields optional)
export const updateEmployeeSchema = z.object({
  params: z.object({
    employeeId: z.string().uuid('Invalid employee ID format'),
  }),
  body: employeeBaseSchema.partial().refine(data => {
    // If payType is updated, ensure the corresponding pay amount is present
    if (data.payType === PayType.SALARY && data.salary === undefined && data.payRate === undefined) {
    }
    if (data.payType === PayType.HOURLY && data.payRate === undefined && data.salary === undefined) {
       // If changing to HOURLY, payRate should ideally be provided.
    }
    // Ensure that if salary is provided, payType is SALARY (or not changing)
    if (data.salary !== undefined && data.payType && data.payType !== PayType.SALARY) {
        return false;
    }
    // Ensure that if payRate is provided, payType is HOURLY (or not changing)
     if (data.payRate !== undefined && data.payType && data.payType !== PayType.HOURLY) {
        return false;
    }
    return true;
  }, {
      message: 'Salary is only applicable for SALARY pay type, and Pay Rate for HOURLY pay type.',
      path: ['salary', 'payRate', 'payType'],
  }),
});

// Schema for validating employee ID in route parameters
export const employeeIdParamSchema = z.object({
  params: z.object({
    employeeId: z.string().uuid('Invalid employee ID format'),
  }),
});

// Schema for query parameters when fetching multiple employees
export const getEmployeesQuerySchema = z.object({
  query: z.object({
    limit: z.string().regex(/^\d+$/).transform(Number).optional().default('10'),
    page: z.string().regex(/^\d+$/).transform(Number).optional().default('1'),
    isActive: z.enum(['true', 'false']).transform(val => val === 'true').optional(),
    sortBy: z.string().optional().default('createdAt'),
    sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
    search: z.string().optional(),
  }),
});

export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>['body'];
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>['body'];
export type GetEmployeesQueryInput = z.infer<typeof getEmployeesQuerySchema>['query'];
