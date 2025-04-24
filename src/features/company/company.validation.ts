import { z } from 'zod';

// Basic reusable ID param schema
export const companyIdParamSchema = z.object({
    params: z.object({
        companyId: z.string().uuid({ message: 'Invalid Company ID format' }),
    }),
});

export const createCompanySchema = z.object({
    body: z.object({
        name: z.string().min(2, 'Company name must be at least 2 characters'),
        email: z.string().email('Invalid company contact email address'),
    }),
});

export const updateCompanySchema = z.object({
    params: companyIdParamSchema.shape.params, // Reuse param schema
    body: z.object({
        name: z.string().min(2, 'Company name must be at least 2 characters').optional(),
        email: z.string().email('Invalid company contact email address').optional(),
    }).refine(data => data.name || data.email, { // Ensure at least one field is provided for update
        message: 'At least one field (name or email) must be provided for update',
        path: ["body"], // General body error
    }),
});

// Schema for listing companies (might have filters later)
export const listCompaniesSchema = z.object({
    query: z.object({
        page: z.string().optional().default('1').transform(val => parseInt(val, 10)),
        limit: z.string().optional().default('10').transform(val => parseInt(val, 10)),
        // Add other filters like name search if needed
        // search: z.string().optional(),
    }),
});

export type CreateCompanyInput = z.infer<typeof createCompanySchema>['body'];
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>['body'];