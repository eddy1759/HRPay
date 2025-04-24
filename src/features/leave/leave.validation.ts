import { z } from 'zod';
import { LeaveType, LeaveRequestStatus} from '@prisma/client';

export const CreateLeaveRequestSchema = z.object({
    body: z.object({
        startDate: z.coerce.date({ 
            required_error: 'Start date is required',
            invalid_type_error: 'Start date must be a valid date',
        }),
        endDate: z.coerce.date({ 
            required_error: 'End date is required',
            invalid_type_error: 'End date must be a valid date',
        }),
        leaveType: z.nativeEnum(LeaveType),
        reason: z.string().optional(),
    }).refine(data => data.endDate >= data.startDate, {
        message: 'End date cannot be earlier than start date',
        path: ['endDate'], // Field to associate the error with
    })
});


export const UpdateLeaveRequestStatusSchema = z.object({
    body: z.object({
        status: z.enum([LeaveRequestStatus.APPROVED, LeaveRequestStatus.REJECTED]), // Only allow approval or rejection via this endpoint
        adminNotes: z.string().optional(),
    }).refine(data => 
        {
            if (data.status === LeaveRequestStatus.APPROVED) {
                return data.adminNotes !== undefined; // Admin notes must be provided if approved
            }
            if (data.status === LeaveRequestStatus.REJECTED) {
                return data.adminNotes !== undefined; // Admin notes must be provided if rejected
            }
            return true; // No validation error if status is not approved or rejected
        }, {
            message: 'Admin notes are required when approving or rejecting a request',
        }),
    params: z.object({
        requestId: z.string().uuid({ message: 'Invalid request ID format' }),
    })
})


export const CancelLeaveRequestSchema = z.object({
    params: z.object({
        requestId: z.string().uuid({ message: 'Invalid request ID format' }),
    })
});


export const GetEmployeeLeaveRequestsSchema = z.object({
    query: z.object({
        status: z.nativeEnum(LeaveRequestStatus).optional(),
        page: z.coerce.number().int().positive().optional(),
        limit: z.coerce.number().int().positive().max(100).optional(),
    })
});





