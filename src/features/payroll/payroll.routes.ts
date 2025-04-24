// src/modules/payroll/payroll.routes.ts
import express from 'express';
import { PayrollController } from './payroll.controller';
import { authMiddleware, authorize } from '../../middleware/authMiddleware'; // Assuming adds req.user, req.companyId
import { validate } from '../../middleware/validate';
import {
    createPayrollSchema,
    payPayrollSchema,
    approvePayrollSchema,
    getPayrollByIdSchema,
    getPayrollsSchema,
    payrollInsightSchema
} from './payroll.validation';
import { UserRole } from '@prisma/client'; // Import roles enum

const router = express.Router();

// Apply authentication to all routes
router.use(authMiddleware);

// Middleware to check roles
const auth = {
    user: [UserRole.EMPLOYEE, UserRole.ADMIN, UserRole.SUPER_ADMIN],
    admin: [UserRole.ADMIN, UserRole.SUPER_ADMIN],
    superAdmin: [UserRole.SUPER_ADMIN]
};

// POST /api/v1/payrolls - Create
router.post(
    '/',
    authorize(auth.admin), // Example roles
    validate(createPayrollSchema),
    PayrollController.createPayroll
);

// GET /api/v1/payrolls - Get List (Paginated)
router.get(
    '/',
    authorize(auth.admin), // Broader read access
    validate(getPayrollsSchema),
    PayrollController.getPayrolls
);

// POST /api/v1/payrolls/insights - AI Insights
router.post(
    '/insights',
    authorize(auth.admin), // Roles needing insights
    validate(payrollInsightSchema),
    PayrollController.getPayrollInsights
);

// --- Routes requiring specific Payroll ID ---

// GET /api/v1/payrolls/:payrollId - Get Single
router.get(
    '/:payrollId',
    authorize(auth.admin), // Read access
    validate(getPayrollByIdSchema),
    PayrollController.getPayrollById
);

// PATCH /api/v1/payrolls/:payrollId/approve - Approve
router.patch(
    '/:payrollId/approve',
    authorize(auth.admin), 
    validate(approvePayrollSchema),
    PayrollController.approvePayroll
);

// PATCH /api/v1/payrolls/:payrollId/pay - Pay
router.patch(
    '/:payrollId/pay',
    authorize(auth.admin), 
    validate(payPayrollSchema),
    PayrollController.payPayroll
);


export const payrollRouter =  router;