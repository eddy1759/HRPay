// src/modules/payroll/payroll.validation.ts
import { z } from 'zod';
import { PayrollStatus } from '@prisma/client';

const isoDateSchema = z.string().datetime({ message: "Invalid ISO 8601 date format" }); // Use Zod's datetime for ISO 8601

// Schema for creating a payroll
export const createPayrollSchema = z.object({
  body: z.object({
    periodStart: isoDateSchema,
    periodEnd: isoDateSchema,
  }).refine(data => new Date(data.periodEnd) > new Date(data.periodStart), {
      message: "Period end date must be after period start date",
      path: ["periodEnd"], // Attach error to the specific field
  }),
});

// Schema for approving payroll (only needs params)
export const approvePayrollSchema = z.object({
  params: z.object({
    payrollId: z.string().uuid({ message: "Invalid Payroll ID format" }),
  }),
});

// Schema for paying payroll
export const payPayrollSchema = z.object({
  params: z.object({
    payrollId: z.string().uuid({ message: "Invalid Payroll ID format" }),
  }),
  body: z.object({
    paymentDate: isoDateSchema,
  }),
});

// Schema for getting payrolls (with pagination and status filter)
export const getPayrollsSchema = z.object({
    query: z.object({
        status: z.nativeEnum(PayrollStatus).optional(),
        page: z.preprocess( // Preprocess to convert string to number
            (val) => parseInt(z.string().optional().default("1").parse(val), 10),
            z.number().int().positive({ message: "Page must be a positive integer" }).optional()
        ),
        limit: z.preprocess( // Preprocess to convert string to number
             (val) => parseInt(z.string().optional().default("20").parse(val), 10),
             z.number().int().positive({ message: "Limit must be a positive integer" }).max(100, { message: "Limit cannot exceed 100" }).optional()
        ),
    }).optional(), // Query itself is optional
});


// Schema for getting single payroll (only needs params)
export const getPayrollByIdSchema = z.object({
  params: z.object({
    payrollId: z.string().uuid({ message: "Invalid Payroll ID format" }),
  }),
});

// Schema for AI Insight Query
export const payrollInsightSchema = z.object({
    body: z.object({
        // Add .trim() to remove leading/trailing whitespace
        // Consider adding further sanitization here if needed to prevent prompt injection,
        // although robust handling should be within the Langchain service itself.
        query: z.string().trim().min(10, { message: "Query must be at least 10 characters long" }).max(500, { message: "Query too long" }),
    }),
});