import { Response } from 'express';
import httpStatus from 'http-status-codes';
import { UserRole, LeaveRequestStatus } from '@prisma/client';

import logger from '@/config/logger';
import { leaveService } from './leave.service';
import { asyncWrapper } from '@/utils/asyncWrapper';
import { AuthRequest } from '@/middleware/authMiddleware';
import { CreateLeaveRequestDto, UpdateLeaveRequestStatusDto } from './leave.types';
import { UnauthorizedError, BadRequestError, ForbiddenError } from '@/utils/ApiError';



/**
 * @description - Controller to get leave balances for the logged-in employee
 * @route GET /api/v1/leave/balances
 * @access Private (requires authentication)
 * @returns {LeaveBalanceResponse[]} - Array of leave balances for the employee
 */
const getBalances = asyncWrapper(async (req: AuthRequest, res: Response) => {
	const user = req.user;
    if (!user?.id) { // Check for user.id instead of employeeId
        logger.warn('User ID missing from req.user in getBalances');
        throw new UnauthorizedError('User context not found'); // Updated error message
    }

	const balances = await leaveService.getLeaveBalances(user.id); // Pass userId
	res.status(httpStatus.OK).json({
		message: 'Leave balances retrieved successfully',
		data: balances,
	});
});


/**
 * @description - Controller to create a leave request for the logged-in employee
 * @route POST /api/v1/leave/requests
 * @access Private (requires authentication)
 * @param {CreateLeaveRequestDto} requestBody - Leave request details
 * @returns {LeaveRequestResponse} - Created leave request details
 */
const createRequest = asyncWrapper(async (req: AuthRequest, res: Response) => {
	const user = req.user;
     if (!user?.id) { // Check for user.id
        logger.warn('User ID missing from req.user in createRequest');
        throw new UnauthorizedError('User context not found'); // Updated error message
    }

	const leaveRequest = await leaveService.createLeaveRequest(user.id, req.body as CreateLeaveRequestDto); 
	res.status(httpStatus.CREATED).json({
		message: 'Leave request created successfully',
		data: leaveRequest,
	});
});


/**
 * @description - Controller to get leave requests for the logged-in employee
 * @route GET /api/v1/leave/requests
 * @access Private (requires authentication)
 * @param {string} statusQuery - Optional query parameter to filter by status
 * @returns {LeaveRequestResponse[]} - Array of leave requests for the employee
 */
const getEmployeeRequests = asyncWrapper(async (req: AuthRequest, res: Response) => {
	const user = req.user;
	const statusQuery = req.query.status as string;

     if (!user?.id) { // Check for user.id
        logger.warn('User ID missing from req.user in getEmployeeRequests');
        throw new UnauthorizedError('User context not found'); 
    }

	const requests = await leaveService.getEmployeeLeaveRequests(user.id, statusQuery as LeaveRequestStatus); // Pass userId
	res.status(httpStatus.OK).json({
		message: 'Leave requests retrieved successfully',
		data: requests,
	});
});


/**
 * @description - Controller to get leave requests for the company (Admin only)
 * @route GET /api/v1/leave/company/requests
 * @access Private (requires ADMIN role)
 * @param {string} statusQuery - Optional query parameter to filter by status
 * @returns {LeaveRequestResponse[]} - Array of leave requests for the company
 */
const getCompanyRequests = asyncWrapper(async (req: AuthRequest, res: Response) => {
	const user = req.user; // Cast req.user
	const statusQuery = req.query.status as string;
	
	if (user?.role !== UserRole.ADMIN || !user?.companyId) {
		throw new ForbiddenError(
			'User must be an Admin to access company leave requests'
		);
	}

	const companyId = user.companyId;

	const requests = await leaveService.getCompanyLeaveRequests(companyId, statusQuery as LeaveRequestStatus); 
	res.status(httpStatus.OK).json({
		message: 'Company leave requests retrieved successfully',
		data: requests
	});
});


/**
 * @description - Controller to update the status of a leave request (Admin only)
 * @route PATCH /api/v1/leave/requests/:requestId/status
 * @access Private (requires ADMIN role)
 * @param {string} requestId - ID of the leave request to update
 * @param {UpdateLeaveRequestStatusDto} requestBody - New status and optional comment
 * @returns {LeaveRequestResponse} - Updated leave request details
 */
const updateRequestStatus = asyncWrapper(async (req: AuthRequest, res: Response) => {
	const user = req.user; // Cast req.user
	
	if (user?.role !== UserRole.ADMIN || !user?.id) {
		throw new ForbiddenError(
			'User must be an Admin to update leave request status'
		);
	}
	const adminUserId = user.id;
	const { requestId } = req.params; 

	if (!requestId) {
		throw new BadRequestError('Leave request ID parameter is required');
	}

	const updatedRequest = await leaveService.updateLeaveRequestStatus(
		requestId,
		adminUserId,
		req.body as UpdateLeaveRequestStatusDto
	);
	res.status(httpStatus.OK).json({
		message: 'Leave request status updated successfully',
		data: updatedRequest
	});
});


/**
 * @description - Controller to cancel a leave request (Employee or Admin)
 * @route PATCH /api/v1/leave/requests/:requestId/cancel
 * @access Private (requires authentication)
 * @param {string} requestId - ID of the leave request to cancel
 * @returns {LeaveRequestResponse} - Cancelled leave request details
 */
const cancelRequest = asyncWrapper(async (req: AuthRequest, res: Response) => {
	const user = req.user; // Cast req.user
	const requestingUserId = user?.id;

	if (!requestingUserId) {
		throw new UnauthorizedError('User ID not found in request context');
	}

	const { requestId } = req.params;
	if (!requestId) {
		throw new BadRequestError('Leave request ID parameter is required');
	}

	const cancelledRequest = await leaveService.cancelLeaveRequest(requestId, requestingUserId);
	res.status(httpStatus.OK).json({
		message: 'Leave request cancelled successfully',
		data: cancelledRequest
	});
});

export const leaveController = {
	getBalances,
	createRequest,
	getEmployeeRequests,
	getCompanyRequests,
	updateRequestStatus,
	cancelRequest,
};
