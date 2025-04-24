import { prisma } from '../../lib/prisma';
import logger from '../../config/logger';
import { amqpWrapper } from '../../lib/amqplib';
import { AuditActionType, Prisma, PayrollStatus, Employee, PayType} from '@prisma/client';
import { GeneratePayrollJobPayload, PAYROLL_JOB_QUEUE, DEAD_LETTER_EXCHANGE, DEAD_LETTER_QUEUE } from '../payroll/payroll.types'; // Import types
import { Decimal } from '@prisma/client/runtime/library';


/**
 * Calculates the gross pay for a single employee based on pay type and hours/salary.
 * @param employee - The employee record.
 * @param periodStart - Pay period start.
 * @param periodEnd - Pay period end.
 * @returns The calculated gross pay.
 */
const calculateEmployeeGrossPay = (employee: Employee, hoursWorked?: number): { grossPay: Decimal, hoursInfo?: { regular: number } } => {
    if (employee.payType === PayType.SALARY && employee.salary) {
        // For salaried employees, gross pay is the monthly salary
        const grossPay = new Decimal(employee.salary);
        return { grossPay };
    } else if (employee.payType === PayType.HOURLY && employee.payRate && hoursWorked !== undefined) {
        // For hourly employees, gross pay is hours worked * hourly rate
        const hourlyRate = new Decimal(employee.payRate);
        const regularHours = new Decimal(hoursWorked);
        const grossPay = regularHours.times(hourlyRate).toDecimalPlaces(2);
        return { grossPay, hoursInfo: { regular: hoursWorked } };
    } else {
        logger.warn(`Cannot calculate gross pay for employee ${employee.id}: Missing salary/payRate or hours worked.`);
        return { grossPay: new Decimal(0) };
    }
};


// --- Job Processing Logic ---

/**
 * Processes a payroll generation job message.
 * Fetches active employees for the period, calculates pay details, updates payroll totals.
 * Designed to be idempotent and handle errors gracefully.
 *
 * @param payload - The parsed message payload.
 * @param message - The raw AMQP message (optional, for advanced ack/nack control).
 * @returns {Promise<boolean>} True if processed successfully (ACK), False if failed permanently (NACK without requeue). Throws for transient errors (NACK with requeue).
 */
const processGeneratePayrollJob = async (payload: GeneratePayrollJobPayload): Promise<boolean> => {
    logger.info(`Processing payroll generation job for payrollId: ${payload.payrollId} (Attempt: ${payload.retryCount ?? 1})`);

    const { payrollId, companyId } = payload;
    
    // --- Idempotency and Status Check ---
    const currentPayroll = await prisma.payroll.findUnique({
        where: { id: payrollId },
        select: { status: true } // Only select status for the check
    });

    if (!currentPayroll) {
        logger.warn(`Payroll ${payrollId} not found during processing. Marking job as failed (no requeue).`);
        return false; // Permanent failure, NACK without requeue (handled by wrapper)
    }

    // If already processed or in a final state, ACK successfully.
    const finalStatuses: PayrollStatus[] = [PayrollStatus.DRAFT, PayrollStatus.APPROVED, PayrollStatus.PAID, PayrollStatus.ERROR /* PayrollStatus.REQUIRES_REVIEW */ ];
    if (finalStatuses.includes(currentPayroll.status)) {
        logger.info(`Payroll ${payrollId} is already in a final state (${currentPayroll.status}). Skipping calculation. Job successful.`);
        return true; // Already done or errored out previously, ACK
    }


    try {
        const payroll = await prisma.payroll.findUnique({
            where: { id: payrollId },
            include: { company: { include: { employees: true } } },
        });

        if (!payroll || payroll.status !== PayrollStatus.DRAFT) {
            logger.warn(`Payroll ${payrollId} not in DRAFT status or not found.`);
            return false;
        }

        const employees = payroll.company.employees.filter((e) => e.isActive);
        if (!employees.length) {
            logger.warn(`No active employees for payroll ${payrollId}.`);
            await prisma.payroll.update({
                where: { id: payrollId },
                data: { totalGross: new Decimal(0), totalNet: new Decimal(0), status: PayrollStatus.DRAFT },
            });
            return true; // ACK
        }

        let totalGross = new Decimal(0);
        let totalNet = new Decimal(0);
        const employeePayrollDetails: Prisma.EmployeePayrollCreateManyInput[] = [];

        for (const employee of employees) {
            let hoursWorked: number | undefined;
            if (employee.payType === PayType.HOURLY) {
                const empPayroll = await prisma.employeePayroll.findFirst({
                    where: { payrollId, employeeId: employee.id },
                });
                hoursWorked = empPayroll?.regularHoursWorked ? Number(empPayroll.regularHoursWorked) : undefined;
            }

            const { grossPay, hoursInfo } = calculateEmployeeGrossPay(employee, hoursWorked);
            const netPay = grossPay; // Simplified: no deductions for now

            employeePayrollDetails.push({
                payrollId,
                employeeId: employee.id,
                grossAmount: grossPay.toDecimalPlaces(2),
                netAmount: netPay.toDecimalPlaces(2),
                regularHoursWorked: hoursInfo?.regular || null,
            });

            totalGross = totalGross.plus(grossPay);
            totalNet = totalNet.plus(netPay);
        }

        // Update database in a transaction
        await prisma.$transaction([
            prisma.employeePayroll.deleteMany({ where: { payrollId } }),
            prisma.employeePayroll.createMany({ data: employeePayrollDetails }),
            prisma.payroll.update({
                where: { id: payrollId },
                data: {
                    totalGross: totalGross.toDecimalPlaces(2),
                    totalNet: totalNet.toDecimalPlaces(2),
                    status: PayrollStatus.DRAFT,
                },
            }),
            prisma.auditLog.create({
                data: {
                    actionType: AuditActionType.PAYROLL_GENERATED,
                    payrollId,
                    details: { totalGross: totalGross.toFixed(2) },
                },
            }),
        ]);

        logger.info(`Payroll ${payrollId} processed successfully.`);
        return true; // ACK
    } catch (error) {
        // Handle race condition if status changed between check and update
        logger.warn(`Failed to mark payroll ${payrollId} as CALCULATING, likely already processed or status changed.`, { error });
        // Re-check status to decide outcome
        const latestPayroll = await prisma.payroll.findUnique({ where: { id: payrollId }, select: { status: true }});
        if (latestPayroll && finalStatuses.includes(latestPayroll.status)) {
        return true; // It resolved to a final state, ACK
        }
        // Otherwise, assume transient issue or unexpected state
        throw new Error(`Failed to acquire lock/update status for payroll ${payrollId}`);
    }
};

// --- Worker Setup ---
export const startPayrollJobProcessor = async () => {
    try {
        logger.info('Attempting to start Payroll Job Processor worker...');

        // Use the new setup method from the wrapper
        await amqpWrapper.setupQueueWithDLX({
             queueName: PAYROLL_JOB_QUEUE,
             options: { durable: true }, // Standard options for main queue
             deadLetterExchange: DEAD_LETTER_EXCHANGE,
             deadLetterQueueName: DEAD_LETTER_QUEUE,
             deadLetterRoutingKey: PAYROLL_JOB_QUEUE, // Route failed messages based on original queue name
        });
        logger.info(`Queue [${PAYROLL_JOB_QUEUE}] and DLX [${DEAD_LETTER_EXCHANGE}] setup verified.`);


        // Use the wrapper to consume messages
        const concurrency = parseInt(process.env.PAYROLL_WORKER_CONCURRENCY || '2', 10);
        logger.info(`Starting consumer for ${PAYROLL_JOB_QUEUE} with concurrency ${concurrency}`);

        // Pass the type for the message payload
        await amqpWrapper.consumeMessages<GeneratePayrollJobPayload>(
            PAYROLL_JOB_QUEUE,
            processGeneratePayrollJob, // Pass the processing function
            { }, // Consumer options (default is noAck: false)
            concurrency
        );

        logger.info(`[*] Payroll Job Processor worker started successfully. Waiting for messages in ${PAYROLL_JOB_QUEUE}.`);

    } catch (error) {
        logger.error('Failed to start Payroll Job Processor worker:', { error });
        // Consider a more graceful shutdown or limited retry mechanism here
        process.exit(1); // Exit if setup fails critically
    }
};
