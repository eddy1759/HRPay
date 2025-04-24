import { Decimal } from '@prisma/client/runtime/library'; 
import { LeaveType, LeaveRequestStatus, UserRole, PrismaClient as PrismaClientType } from '@prisma/client';

import { prisma } from '@/lib/prisma'; 
import { CreateLeaveRequestDto, LeaveBalanceResponse, LeaveRequestResponse, UpdateLeaveRequestStatusDto } from './leave.types';
import { NotFoundError, BadRequestError, ForbiddenError, InternalServerError, UnauthorizedError } from '@/utils/ApiError';


/**
 * @description - Helper function to get employeeId from userId
 * @param {string} userId - The ID of the user (employee)
 * @return {string} - The ID of the employee
 * @throws {NotFoundError} - If the employee record is not found
 */
const getEmployeeIdFromUserId = async (userId: string, tx?: PrismaClientType): Promise<string> => {
    const prismaClient = tx || prisma; // Use transaction client if provided
    const employee = await prismaClient.employee.findUnique({
        where: { userId },
        select: { id: true },
    });
    if (!employee) {
        throw new NotFoundError('Employee record not found for this user.');
    }
    return employee.id;
};


/**
 * @description - Helper function to calculate the duration between two dates
 * @param {Date} startDate - The start date
 * @param {Date} endDate - The end date
 * @param {boolean} excludeWeekends - Whether to exclude weekends from the calculation
 * @return {Decimal} - The duration in days as a Decimal object
 */
const calculateDuration = (
    startDate: Date,
    endDate: Date,
    excludeWeekends = true
  ): Decimal => {
    // normalize both to midnight
    const start = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
    const end   = new Date(endDate.getFullYear(),   endDate.getMonth(),   endDate.getDate());
    if (end < start) return new Decimal(0);
  
    let count = 0;
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const day = d.getDay(); // 0=Sun…6=Sat
      if (excludeWeekends && (day === 0 || day === 6)) continue;
      count++;
    }
  
    return new Decimal(count);
};


/**
 * * @description - Get leave balances for the logged-in employee
 * * @param {string} userId - The ID of the user (employee)
 * * @return {Promise<LeaveBalanceResponse[]>} - Array of leave balances for the employee
 * * @throws {NotFoundError} - If the employee record is not found
 */
const getLeaveBalances = async (userId: string): Promise<LeaveBalanceResponse[]> => {
    const employeeId = await getEmployeeIdFromUserId(userId); // Fetch employeeId
    const balances = await prisma.leaveBalance.findMany({
        where: { employeeId }, // Use fetched employeeId
        select: {
            leaveType: true,
            balance: true,
            unit: true,
            createdAt: true, // Added missing field
            updatedAt: true,
        },
    });
    return balances;
};

/**
 * @description - Create a leave request for the logged-in employee
 * @param {string} userId - The ID of the user (employee)
 * @param {CreateLeaveRequestDto} data - Leave request details
 * @return {Promise<LeaveRequestResponse>} - Created leave request details
 * @throws {BadRequestError} - If the leave request is invalid or insufficient balance
 * @throws {NotFoundError} - If the employee record is not found or leave balance record is not found
 */
const createLeaveRequest = async (
    userId: string, // Changed parameter name
    data: CreateLeaveRequestDto
): Promise<LeaveRequestResponse> => {
    const employeeId = await getEmployeeIdFromUserId(userId); 
    const { startDate, endDate, leaveType, reason } = data.body 

    // 1. Validate Dates (using data directly)
    if (endDate < startDate) {
         throw new BadRequestError('End date cannot be earlier than start date');
    }

    // 2. Calculate Duration
    const duration = calculateDuration(startDate, endDate);
    if (duration.lessThanOrEqualTo(0)) {
        throw new BadRequestError('Leave duration must be at least one day');
    }


    // 3. Check Sufficient Balance (except for UNPAID leave)
    if (leaveType !== LeaveType.UNPAID) {
        const balanceRecord = await prisma.leaveBalance.findUnique({
            where: {
                employeeId_leaveType: { employeeId, leaveType },
            },
        });

        if (!balanceRecord) {
             throw new NotFoundError(`Leave balance record not found for type ${leaveType}`);
        }
        if (balanceRecord.balance.lessThan(duration)) {
            throw new BadRequestError(`Insufficient ${leaveType} leave balance. Available: ${balanceRecord.balance}, Requested: ${duration}`);
        }
    }

    // 4. Create Leave Request
    const leaveRequest = await prisma.leaveRequest.create({
        data: {
            employeeId, // Use fetched employeeId
            leaveType,
            startDate,
            endDate,
            duration,
            reason,
            status: LeaveRequestStatus.PENDING, // Initial status
        },
    });

    // Exclude employeeId for the response
    const { employeeId: _, ...response } = leaveRequest;
    return response;
};


/**
 * @description - Get leave requests for the logged-in employee
 * @param {string} userId - The ID of the user (employee)
 * @param {LeaveRequestStatus} status - Optional status to filter requests
 * @return {Promise<LeaveRequestResponse[]>} - Array of leave requests for the employee
 */
const getEmployeeLeaveRequests = async (
    userId: string, // Changed parameter name
    status?: LeaveRequestStatus
): Promise<LeaveRequestResponse[]> => {
    const employeeId = await getEmployeeIdFromUserId(userId); // Fetch employeeId
    const requests = await prisma.leaveRequest.findMany({
        where: {
            employeeId, 
            status: status, 
        },
        orderBy: {
            createdAt: 'desc',
        },
        select: {
            id: true,
            leaveType: true,
            startDate: true,
            endDate: true,
            duration: true,
            reason: true,
            status: true,
            adminNotes: true,
            createdAt: true,
            updatedAt: true,
        }
    });
    return requests;
};

// For Admins/Managers
/**
 * * @description - Get leave requests for a specific company (for Admins/Managers)
 * * @param {string} companyId - The ID of the company
 * * @param {LeaveRequestStatus} status - Optional status to filter requests
 * * @return {Promise<LeaveRequestResponse[]>} - Array of leave requests for the company
 */
const getCompanyLeaveRequests = async (
    companyId: string, // Need companyId to filter
    status?: LeaveRequestStatus
): Promise<LeaveRequestResponse[]> => {
    // Find requests for employees belonging to the specified company
    const requests = await prisma.leaveRequest.findMany({
        where: {
            employee: {
                companyId: companyId,
                isActive: true, 
            },
            status: status,
        },
        include: { 
            employee: {
                select: { id: true, firstName: true, lastName: true, email: true }
            }
        },
        orderBy: {
            createdAt: 'desc',
        },
    });

    // Map to desired response structure, excluding sensitive or redundant fields
    return requests.map(req => {
        const { employeeId: _, employee, ...rest } = req; 
        return { ...rest, employee }; 
    });
};


/**
 * @description - Update the status of a leave request (for Admins/Managers)
 * @param {string} requestId - The ID of the leave request
 * @param {string} adminUserId - The ID of the user performing the action (Admin/Manager)
 * @param {UpdateLeaveRequestStatusDto} data - Status update details
 * @return {Promise<LeaveRequestResponse>} - Updated leave request details
 * @throws {NotFoundError} - If the leave request or employee record is not found
 * @throws {BadRequestError} - If the request is not in a valid state for updating
 * @throws {ForbiddenError} - If the user does not have permission to update the request
 */
const updateLeaveRequestStatus = async (
    requestId: string,
    adminUserId: string, // ID of the user performing the action
    data: UpdateLeaveRequestStatusDto
): Promise<LeaveRequestResponse> => {
    const { status, adminNotes } = data.body;

    // Use transaction for atomicity (find request, check balance, update request, update balance)
    return prisma.$transaction(async (tx) => {
        // 1. Find the request and verify admin's company
        const leaveRequest = await tx.leaveRequest.findUnique({
            where: { id: requestId },
            include: {
                employee: { // Include employee to get companyId
                    select: { companyId: true, id: true } // Renamed employeeId to id for clarity
                }
            }
        });

        if (!leaveRequest) {
            throw new NotFoundError('Leave request not found');
        }

        // 2. Verify Admin Permissions
        const adminUser = await tx.user.findUnique({
            where: { id: adminUserId },
            select: { role: true, companyId: true }
        });

        // Ensure admin exists, belongs to the same company, and has ADMIN role
        if (!adminUser || adminUser.companyId !== leaveRequest.employee.companyId || adminUser.role !== UserRole.ADMIN) {
             throw new ForbiddenError('User does not have permission to update this request');
        }

        // 3. Check if the request is pending
        if (leaveRequest.status !== LeaveRequestStatus.PENDING) {
            throw new BadRequestError(`Cannot update status of a request that is already ${leaveRequest.status}`);
        }

        // 4. Handle Approval
        if (status === LeaveRequestStatus.APPROVED) {
            // Re-check balance (except for UNPAID) and deduct if sufficient
            if (leaveRequest.leaveType !== LeaveType.UNPAID) {
                const balanceRecord = await tx.leaveBalance.findUnique({
                    where: {
                        employeeId_leaveType: { employeeId: leaveRequest.employee.id, leaveType: leaveRequest.leaveType },
                    },
                });

                 if (!balanceRecord) {
                    // This case should ideally not happen if creation validation is correct, but good to check
                    throw new InternalServerError(`Leave balance record not found for employee ${leaveRequest.employee.id} and type ${leaveRequest.leaveType}`);
                 }

                if (balanceRecord.balance.lessThan(leaveRequest.duration)) {
                    throw new BadRequestError(`Insufficient ${leaveRequest.leaveType} leave balance for employee. Available: ${balanceRecord.balance}, Requested: ${leaveRequest.duration}`);
                }

                // Deduct balance
                await tx.leaveBalance.update({
                    where: {
                         employeeId_leaveType: { employeeId: leaveRequest.employee.id, leaveType: leaveRequest.leaveType },
                    },
                    data: {
                        balance: {
                            decrement: leaveRequest.duration,
                        },
                    },
                });
            }
        }
        // Note: No balance adjustment needed for REJECTED status

        // 5. Update Leave Request Status and Notes
        const updatedRequest = await tx.leaveRequest.update({
            where: { id: requestId },
            data: {
                status,
                adminNotes: adminNotes?.trim() || null, // Store null if empty/whitespace
            },
        });

        const { employeeId: _, ...response } = updatedRequest;
        return response;
    });
};


/**
 * @description - Cancel a leave request (for employee or admin)
 * @param {string} requestId - The ID of the leave request
 * @param {string} requestingUserId - The ID of the user making the cancellation (employee or admin)
 * @return {Promise<LeaveRequestResponse>} - Updated leave request details
 * @throws {NotFoundError} - If the leave request or employee record is not found
 * @throws {BadRequestError} - If the request is not in a valid state for cancellation
 * @throws {ForbiddenError} - If the user does not have permission to cancel the request
 */
const cancelLeaveRequest = async (
    requestId: string,
    requestingUserId: string // ID of user making the cancellation (employee or admin)
): Promise<LeaveRequestResponse> => {

    return prisma.$transaction(async (tx) => {
        // 1. Find the request and related user/employee info
        const leaveRequest = await tx.leaveRequest.findUnique({
            where: { id: requestId },
            include: {
                employee: {
                    select: { companyId: true, userId: true, id: true } // Need employee's userId, companyId, and employee.id
                }
            }
        });

        if (!leaveRequest) {
            throw new NotFoundError('Leave request not found');
        }

        // 2. Verify Permissions
        const requestingUser = await tx.user.findUnique({
            where: { id: requestingUserId },
            select: { role: true, companyId: true, id: true }
        });

        if (!requestingUser) {
             throw new UnauthorizedError('Requesting user not found');
        }

        // Check if the requesting user is the employee who owns the request
        const isOwner = requestingUser.id === leaveRequest.employee.userId;
        // Check if the requesting user is an admin of the same company
        const isAdmin = requestingUser.role === UserRole.ADMIN && requestingUser.companyId === leaveRequest.employee.companyId;

        if (!isOwner && !isAdmin) {
            throw new ForbiddenError('User does not have permission to cancel this request');
        }

        // 3. Check if the request is cancellable (only PENDING)
        if (leaveRequest.status !== LeaveRequestStatus.PENDING) {
            throw new BadRequestError(`Cannot cancel a request with status ${leaveRequest.status}. Only PENDING requests can be cancelled.`);
        }

        // 4. Update status to CANCELLED
        const cancelledRequest = await tx.leaveRequest.update({
            where: { id: requestId },
            data: {
                status: LeaveRequestStatus.CANCELLED,
                // Optionally add a note about who cancelled it if needed
                adminNotes: isOwner ? (leaveRequest.adminNotes ? `${leaveRequest.adminNotes}\nCancelled by employee.` : 'Cancelled by employee.')
                                    : (leaveRequest.adminNotes ? `${leaveRequest.adminNotes}\nCancelled by admin.` : 'Cancelled by admin.'),
            },
        });

        const { employeeId: _, ...response } = cancelledRequest;
        return response;
    });
};


export const leaveService = {
    getLeaveBalances,
    createLeaveRequest,
    getEmployeeLeaveRequests,
    getCompanyLeaveRequests,
    updateLeaveRequestStatus,
    cancelLeaveRequest,
}