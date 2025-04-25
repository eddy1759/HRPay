import { PrismaClient, Payroll, PayrollStatus, AuditActionType, Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import httpStatus from 'http-status-codes';
import { ApiError } from '../../utils/ApiError';
import { validatePayrollTransition, assertPayrollStatus } from '../../utils/stateMachine';
// calculateGrossPay is likely only needed in the job processor now, but keep import for the helper function below
import { calculateGrossPay } from './payroll.utils';
import { amqpWrapper } from '../../lib/amqplib'; // Import the RabbitMQ wrapper
import { GeneratePayrollJobPayload }  from './payroll.types'; // Import job payload type
import logger from '../../config/logger'; // Imp

const prisma = new PrismaClient();


/**
 * Checks for existing payrolls within the same company that overlap with the proposed period.
 * Throws an ApiError if an overlap is found.
 * @param companyId - The ID of the company.
 * @param periodStart - Proposed start date.
 * @param periodEnd - Proposed end date.
 * @param tx - Optional Prisma transaction client.
 */
const checkForOverlappingPayrolls = async (
  companyId: string,
  periodStart: Date,
  periodEnd: Date,
  tx?: Prisma.TransactionClient // Allow passing transaction client
): Promise<void> => {
  const database = tx || prisma;
  const overlappingPayroll = await database.payroll.findFirst({
    where: {
      companyId: companyId,
      OR: [
        // New period is completely within an existing period
        { periodStart: { lte: periodStart }, periodEnd: { gte: periodEnd } },
        // New period starts within an existing period
        { periodStart: { lte: periodStart }, periodEnd: { gte: periodStart } },
        // New period ends within an existing period
        { periodStart: { lte: periodEnd }, periodEnd: { gte: periodEnd } },
        // New period completely envelops an existing period
        { periodStart: { gte: periodStart }, periodEnd: { lte: periodEnd } },
      ],
    },
    select: { id: true, periodStart: true, periodEnd: true }, // Select only needed fields
  });

  if (overlappingPayroll) {
    throw new ApiError(
      httpStatus.CONFLICT,
      `Payroll period conflicts with existing payroll ${overlappingPayroll.id} (${overlappingPayroll.periodStart.toDateString()} - ${overlappingPayroll.periodEnd.toDateString()}).`
    );
  }
};

/**
 * Creates a draft payroll record for a given company and period.
 * This might trigger a background job for detailed calculation in a real scenario.
 *
 * @param companyId - The ID of the company.
 * @param periodStart - The start date of the pay period.
 * @param periodEnd - The end date of the pay period.
 * @param generatedById - The ID of the user generating the payroll.
 * @returns The newly created draft payroll record.
 */
const createPayroll = async (
  companyId: string,
  periodStart: Date,
  periodEnd: Date,
  generatedById: string
): Promise<Payroll> => {
  // Basic validation
  if (periodEnd <= periodStart) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Period end date must be after period start date.');
  }

  let newPayroll: Payroll | null = null;

  // In a real system, you might check for overlapping payroll periods for the same company.
  try {

    newPayroll = await prisma.$transaction(async (tx) => {
      // Check for overlapping payrolls within the transaction
      await checkForOverlappingPayrolls(companyId, periodStart, periodEnd, tx);
  
      // Create the draft payroll record
      const payrollData: Prisma.PayrollCreateInput = {
        company: { connect: { id: companyId } },
        periodStart,
        periodEnd,
        status: PayrollStatus.DRAFT,
        totalGross: new Decimal(0),
        totalNet: new Decimal(0),
      };
  
      const createdPayroll = await tx.payroll.create({ data: payrollData });

      await tx.auditLog.create({
        data: {
          actionType: AuditActionType.PAYROLL_GENERATED,
          userId: generatedById,
          payrollId: createdPayroll.id,
          details: `Payroll generation initiated for period: ${periodStart.toISOString()} - ${periodEnd.toISOString()}`
        }
      });

      return createdPayroll;
    });
  
    // --- Publish Job to RabbitMQ for Calculation ---
    const jobPayload: GeneratePayrollJobPayload = {
      payrollId: newPayroll.id,
      companyId: newPayroll.companyId,
      periodStart: newPayroll.periodStart.toISOString(), // Serialize dates
      periodEnd: newPayroll.periodEnd.toISOString(),
      generatedById: generatedById,
    };
  
    const published = await amqpWrapper.publishMessage('PAYROLL_JOB_QUEUE', jobPayload);
  
    if (!published) {
      logger.error(`CRITICAL: Failed to publish payroll calculation job for payrollId: ${newPayroll.id}. Payroll created but calculation not queued.`);
      // Option 1: Update payroll status to ERROR state
      await prisma.payroll.update({
          where: { id: newPayroll.id },
          data: { status: PayrollStatus.ERROR, // Add an ERROR status to your enum
                  // Add error details field? e.g., calculationError: 'Failed to queue job'
                 },
      });
       await prisma.auditLog.create({
        data: {
          actionType: AuditActionType.PAYROLL_QUEUE_FAILURE, // Or specific PAYROLL_QUEUE_FAILURE
          userId: null, // System action
          payrollId: newPayroll.id,
          details: `Failed to queue payroll calculation job after DB creation.`
        }
      });
      // Option 2: Throw an error back to the user (might be confusing as payroll *was* created)
      throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Payroll created, but failed to queue background calculation. Please contact support.');
      // Option 3: Implement Outbox Pattern (more complex, guarantees eventual consistency)
    } else {
        logger.info(`Payroll calculation job queued for payrollId: ${newPayroll.id}`);
    }
  
    return newPayroll; // Return the initial draft payroll (calculation will happen async)
  } catch (error) {
    if (error instanceof ApiError) {
      throw error; // Re-throw known API errors (e.g., overlap conflict)
    }
    // Log unexpected errors
    logger.error(`Error creating payroll for company ${companyId}: ${error instanceof Error ? error.message : 'Unknown error'}`, { error });

    // If the transaction failed, newPayroll will be null or the error originated there.
    // If queuing failed and we threw an error, it's handled here.
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to create payroll.');
  }
};


/**
 * Approves a draft payroll.
 *
 * @param payrollId - The ID of the payroll to approve.
 * @param approvedById - The ID of the user approving the payroll.
 * @returns The updated payroll record with status APPROVED.
 * @throws {ApiError} If the payroll is not found or not in DRAFT status.
 */
const approvePayroll = async (payrollId: string, approvedById: string): Promise<Payroll> => {
  const payroll = await prisma.payroll.findUnique({
    where: { id: payrollId },
  });

  if (!payroll) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Payroll not found.');
  }

  // Validate status transition
  assertPayrollStatus(payroll, PayrollStatus.DRAFT, 'Only DRAFT payrolls can be approved.');
  validatePayrollTransition(payroll.status, PayrollStatus.APPROVED);

  const updatedPayroll = await prisma.$transaction(async (tx) => {
    const approvedPayroll = await tx.payroll.update({
      where: { id: payrollId },
      data: {
        status: PayrollStatus.APPROVED,
      },
    });

    // Log the approval event
    await tx.auditLog.create({
      data: {
        actionType: AuditActionType.PAYROLL_APPROVED,
        userId: approvedById,
        payrollId: payrollId,
        details: `Payroll approved. Previous status: ${payroll.status}`
      }
    });
    return approvedPayroll;
  });


  return updatedPayroll;
};

/**
 * Marks an approved payroll as paid.
 * In a real system, this would likely trigger actual payment processing via an external service.
 *
 * @param payrollId - The ID of the payroll to mark as paid.
 * @param paidById - The ID of the user marking the payroll as paid.
 * @param paymentDate - The actual date the payment was processed.
 * @returns The updated payroll record with status PAID.
 * @throws {ApiError} If the payroll is not found or not in APPROVED status.
 */
const payPayroll = async (payrollId: string, paidById: string, paymentDate: Date): Promise<Payroll> => {
  const payroll = await prisma.payroll.findUnique({
    where: { id: payrollId },
  });

  if (!payroll) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Payroll not found.');
  }

  // Validate status transition
  assertPayrollStatus(payroll, PayrollStatus.APPROVED, 'Only APPROVED payrolls can be paid.');
  validatePayrollTransition(payroll.status, PayrollStatus.PAID);

  // TODO: Integrate with actual payment gateway/service here
  // --- TODO: Integrate with actual payment gateway/service HERE ---
  // This section would involve:
  // 1. Calling the payment service API with payroll details (employee bank info, amounts).
  // 2. Handling success/failure responses from the payment service.
  // 3. If payment fails, decide whether to retry, update payroll status to PAYMENT_FAILED, or alert admins.
  // logger.info(`Simulating payment processing for payroll ${payrollId}...`);
  // const paymentSuccessful = true; // Replace with actual payment service call result

  // if (!paymentSuccessful) {
  //   // Log failure and potentially update status
  //   logger.error(`Payment processing failed for payroll ${payrollId}.`);
  //    await prisma.auditLog.create({
  //        data: {
  //            actionType: AuditActionType.PAYMENT_FAILURE, // Add specific action type
  //            userId: paidBy.id,
  //            payrollId: payrollId,
  //            companyId: payroll.companyId,
  //            details: `Payment initiation failed at ${new Date().toISOString()}`
  //        }
  //    });
  //   // Optionally update status to PAYMENT_FAILED or keep as APPROVED for retry
  //   // await prisma.payroll.update({ where: { id: payrollId }, data: { status: PayrollStatus.PAYMENT_FAILED } });
  //   throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Payment processing failed.');
  // }
  // // --- End Payment Integration Placeholder ---

  const updatedPayroll = await prisma.$transaction(async (tx) => {
    const paidPayroll = await tx.payroll.update({
      where: { id: payrollId },
      data: {
        status: PayrollStatus.PAID,
        paymentDate: paymentDate, // Record the actual payment date
      },
    });

     // Log the payment event
     await tx.auditLog.create({
      data: {
        actionType: AuditActionType.PAYROLL_PAID,
        userId: paidById,
        payrollId: payrollId,
        details: `Payroll marked as paid. Payment Date: ${paymentDate.toISOString()}`
      }
    });

    // TODO: Trigger post-payment actions (e.g., generating payslips, notifications)
    // await queuePayslipGenerationJob(paidPayroll.id);

    return paidPayroll;
  });


  return updatedPayroll;
};

/**
 * Retrieves a specific payroll by its ID, including details.
 *
 * @param payrollId - The ID of the payroll to retrieve.
 * @returns The payroll object with associated details, or null if not found.
 */
const getPayrollById = async (payrollId: string, companyId: string): Promise<Payroll | null> => {
  return prisma.payroll.findUnique({
    where: { id: payrollId, companyId: companyId, },
    include: {
      details: { // Include employee payroll details
        orderBy: { employee: { lastName: 'asc' } }, // Example ordering
        include: {
          // Select only necessary employee fields
          employee: { select: { id: true, firstName: true, lastName: true, email: true } }
        }
      }
    },
  });
};

/**
 * Retrieves all payrolls for a specific company, optionally filtered by status.
 *
 * @param companyId - The ID of the company.
 * @param status - Optional status to filter by.
 * @param page - Page number for pagination (default: 1).
 * @param limit - Number of items per page (default: 20).
 * @returns A list of payrolls.
 */
const getPayrollsByCompany = async (
  companyId: string,
  status?: PayrollStatus,
  page: number = 1,
  limit: number = 20
): Promise<{ payrolls: Payroll[], totalCount: number, totalPages: number }> => {

  const whereClause: Prisma.PayrollWhereInput = {
      companyId: companyId,
      ...(status && { status: status }), // Add status filter if provided
  };

  const skip = (page - 1) * limit;

  const [payrolls, totalCount] = await prisma.$transaction([
      prisma.payroll.findMany({
          where: whereClause,
          skip: skip,
          take: limit,
          orderBy: {
            periodEnd: 'desc', // Show most recent first
          },
        }),
      prisma.payroll.count({ where: whereClause })
  ]);

  const totalPages = Math.ceil(totalCount / limit);

  return { payrolls, totalCount, totalPages };
};




export const PayrollService = {
  createPayroll,
  approvePayroll,
  payPayroll,
  getPayrollById,
  getPayrollsByCompany,
};
