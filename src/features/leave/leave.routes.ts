import { Router } from 'express';
import { UserRole } from '@prisma/client';

import { leaveController } from './leave.controller';
import { validate } from '../../middleware/validate';
import { authMiddleware, authorize } from '../../middleware/authMiddleware';
import {
    CreateLeaveRequestSchema,
    UpdateLeaveRequestStatusSchema,
    CancelLeaveRequestSchema
} from './leave.validation';


/**
 * @module leaveRouter
 * @description Express router for handling leave-related API endpoints.
 *
 * This router includes routes for employees to manage their leave balances and requests,
 * and routes for administrators to manage company-wide leave requests.
 *
 * All routes under this router require authentication via `authMiddleware`.
 */
const router = Router();


/**
 * @description Apply authentication middleware to all routes in this router.
 * Requires a valid JWT token.
 */
router.use(authMiddleware);


/**
 * @description Get the leave balances for the authenticated employee.
 * @route -  GET /api/leave/balances 
 * @access  Employee (authenticated)
 */
router.get('/balances', leaveController.getBalances);


/**
 * Route group for /api/v1/leave/requests
 */
router.route('/requests')
    /**
     * @route - POST /api/leave/requests
     * @description Create a new leave request for the authenticated employee.
     * @middleware {authMiddleware} - Requires user to be authenticated.
     * @middleware {validate} - Validates the request body against `CreateLeaveRequestSchema`.
     */
    .post(
        validate(CreateLeaveRequestSchema),
        leaveController.createRequest
    )
    /**
     * @route - GET /api/v1/leave/requests
     * @description Get all leave requests for the authenticated employee.
     * @middleware {authMiddleware} - Requires user to be authenticated.
     */
    .get(
        leaveController.getEmployeeRequests
    );

/**
 * @route - PATCH /api/v1/leave/requests/:requestId/cancel
 * @description Cancel a specific leave request for the authenticated employee.
 * @param {string} requestId - The ID of the leave request to cancel.
 * @middleware {authMiddleware} - Requires user to be authenticated.
 * @middleware {validate} - Validates the request parameters against `CancelLeaveRequestSchema`.
 */
router.patch(
    '/requests/:requestId/cancel',
    validate(CancelLeaveRequestSchema),
    leaveController.cancelRequest
);


// --- Admin Routes (Require ADMIN role) ---

/**
 * @route - GET /api/v1/leave/company/requests
 * @description Get all leave requests across the company (Admin only).
 * @acces - Admin (authenticated)
 * @middleware {authMiddleware} - Requires user to be authenticated.
 * @middleware {authorize} - Requires the authenticated user to have the `ADMIN` role.
 */
router.get(
    '/company/requests',
    authorize([UserRole.ADMIN]),
    leaveController.getCompanyRequests
);

/**
 * PATCH /api/v1/leave/requests/:requestId/status
 * @description Update the status of a specific leave request (Admin only).
 * @param {string} requestId - The ID of the leave request to update.
 * @middleware {authMiddleware} - Requires user to be authenticated.
 * @middleware {authorize} - Requires the authenticated user to have the `ADMIN` role.
 * @middleware {validate} - Validates the request body and parameters against `UpdateLeaveRequestStatusSchema`.
 */
router.patch(
    '/requests/:requestId/status',
    authorize([UserRole.ADMIN]), // Ensure user is an Admin
    validate(UpdateLeaveRequestStatusSchema),
    leaveController.updateRequestStatus
);

// Note: Admins can also cancel requests using the PATCH /requests/:requestId/cancel route above.


export default router;