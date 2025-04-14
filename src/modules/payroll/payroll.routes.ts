import express from 'express';
import { validate } from '@/middleware/validate';
import { authMiddleware, authorize } from '@/middleware/authMiddleware';
import { UserRole } from '@prisma/client';
import {
    generatePayrollSchema,
    payrollHistorySchema,
    payrollReportSchema,
    // Add schemas for basic CRUD params/body if needed
} from './payroll.validation';
import * as payrollController from './payroll.controller';
// Potentially import nested EmployeePayroll routes
// import employeePayrollRouter from './employeePayroll/employeePayroll.routes';

const router = express.Router();

// Apply auth to all payroll routes
router.use(authMiddleware);
// Apply authorization - only ADMINs/SUPER_ADMINs can manage payroll
router.use(authorize([UserRole.ADMIN, UserRole.SUPER_ADMIN]));

// --- Advanced Actions ---
router.post(
    '/generate',
    validate(generatePayrollSchema),
    payrollController.generatePayrollRun
);

router.get(
    '/history',
    validate(payrollHistorySchema),
    payrollController.getPayrollHistory
);

router.get(
    '/report',
    validate(payrollReportSchema),
    payrollController.generatePayrollReport
);

// --- Optional Basic CRUD Routes ---
// Example: Get specific payroll (requires companyId context for security)
// router.get('/:payrollId', validate(payrollIdParamSchema), payrollController.getPayroll);

// Example: Update status (consider PATCH)
// router.patch('/:payrollId/status', validate(updateStatusSchema), payrollController.updatePayrollStatus);

// Example: Delete draft payroll
// router.delete('/:payrollId', validate(payrollIdParamSchema), payrollController.deleteDraftPayroll);


// --- Nested Routes for EmployeePayroll details ---
// Example: Mount routes defined in employeePayroll.routes.ts
// router.use('/:payrollId/details', employeePayrollRouter);


export default router;