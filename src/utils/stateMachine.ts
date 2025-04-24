import { PayrollStatus } from '@prisma/client';
import { ApiError} from './ApiError';
import httpStatus from 'http-status-codes';

/**
 * Defines the valid transitions between payroll statuses.
 * Key: Current Status
 * Value: Array of valid next statuses
 */
const validTransitions: Record<PayrollStatus, PayrollStatus[]> = {
  [PayrollStatus.DRAFT]: [PayrollStatus.APPROVED],
  [PayrollStatus.APPROVED]: [PayrollStatus.PAID],
  [PayrollStatus.PAID]: [], // Terminal state
  [PayrollStatus.ERROR]: [], // Terminal state
  [PayrollStatus.CANCELLED]: [], // Terminal state
};

/**
 * Validates if a transition from the current status to the next status is allowed.
 * Throws an ApiError if the transition is invalid.
 *
 * @param currentStatus - The current status of the payroll.
 * @param nextStatus - The desired next status for the payroll.
 * @throws {ApiError} If the transition is not permitted.
 */
export const validatePayrollTransition = (
  currentStatus: PayrollStatus,
  nextStatus: PayrollStatus
): void => {
  if (currentStatus === nextStatus) {
    // No transition needed, or attempting to transition to the same state
    return; // Or throw an error if transitioning to the same state is invalid
  }

  const allowedTransitions = validTransitions[currentStatus];

  if (!allowedTransitions || !allowedTransitions.includes(nextStatus)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Invalid payroll transition: Cannot move from ${currentStatus} to ${nextStatus}.`
    );
  }
};

/**
 * Checks if a payroll is in a specific status.
 *
 * @param payroll - The payroll object (must have a 'status' property).
 * @param expectedStatus - The status the payroll is expected to be in.
 * @param errorMessage - Optional custom error message if the status doesn't match.
 * @throws {ApiError} If the payroll status does not match the expected status.
 */
export const assertPayrollStatus = (
  payroll: { status: PayrollStatus },
  expectedStatus: PayrollStatus,
  errorMessage?: string
): void => {
  if (payroll.status !== expectedStatus) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      errorMessage || `Payroll must be in ${expectedStatus} status for this operation.`
    );
  }
};
