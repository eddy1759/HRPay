import { z } from 'zod';
import { PayrollStatus, UserRole } from '@prisma/client';

// Schema for triggering a payroll run
export const generatePayrollSchema = z.object({
    body: z.object({
        companyId: z.string().uuid(), // Explicitly require companyId, even if derivable from token, for clarity & SUPER_ADMIN case
        periodStart: z.coerce.date({ message: 'Invalid period start date' }), // Coerce string input to Date
        periodEnd: z.coerce.date({ message: 'Invalid period end date' }),
        // Optional: specific employee IDs to include? Default to all eligible in company?
        // employeeIds: z.array(z.string().uuid()).optional(),
    }).refine((data) => data.periodEnd >= data.periodStart, {
        message: 'Period end date must be on or after period start date',
        path: ['periodEnd'],
    }),
});

// Schema for fetching payroll history
export const payrollHistorySchema = z.object({
    query: z.object({
        companyId: z.string().uuid(), // Allow filtering by company (useful for SUPER_ADMIN)
        status: z.nativeEnum(PayrollStatus).optional(),
        startDate: z.coerce.date().optional(), // Filter by processedAt or periodEnd date range
        endDate: z.coerce.date().optional(),
        page: z.string().optional().default('1').transform(val => Math.max(1, parseInt(val, 10))),
        limit: z.string().optional().default('10').transform(val => Math.min(100, Math.max(1, parseInt(val, 10)))),
    }),
});

// Schema for generating reports
export const payrollReportSchema = z.object({
    query: z.object({
        companyId: z.string().uuid(),
        naturalLanguageQuery: z.string().min(5, { message: "Query must be at least 5 characters"}),
        // Optional date range context for the query
        startDate: z.coerce.date().optional(),
        endDate: z.coerce.date().optional(),
    }),
});

export type GeneratePayrollInput = z.infer<typeof generatePayrollSchema>['body'];
export type PayrollHistoryQuery = z.infer<typeof payrollHistorySchema>['query'];
export type PayrollReportQuery = z.infer<typeof payrollReportSchema>['query'];