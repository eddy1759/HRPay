import { z } from 'zod';
import { LeaveBalance, LeaveRequest, LeaveType, LeaveRequestStatus} from '@prisma/client';
import {CreateLeaveRequestSchema, UpdateLeaveRequestStatusSchema, CancelLeaveRequestSchema,  GetEmployeeLeaveRequestsSchema} from './leave.validation'; 


export type CreateLeaveRequestDto = z.infer<typeof CreateLeaveRequestSchema>;
export type UpdateLeaveRequestStatusDto = z.infer<typeof UpdateLeaveRequestStatusSchema>;
export type CancelLeaveRequestDto = z.infer<typeof CancelLeaveRequestSchema>;
export type GetEmployeeLeaveRequestsDto = z.infer<typeof GetEmployeeLeaveRequestsSchema>;


export interface LeaveBalanceResponse extends Omit<LeaveBalance, 'employeeId' | 'id'> {
}
export interface LeaveRequestResponse extends Omit<LeaveRequest, 'employeeId'> {
}
export interface LeaveRequestStatusUpdateResponse extends Omit<LeaveRequest, 'employeeId'> {
}