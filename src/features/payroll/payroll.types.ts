export interface GeneratePayrollJobPayload {
    payrollId: string;
    companyId: string;
    periodStart: string; // Often serialized as ISO string
    periodEnd: string;   // Often serialized as ISO string
    generatedById: string;
    retryCount?: number; // Optional: track retries if needed
}

// Name of the primary queue for payroll calculation jobs
export const PAYROLL_JOB_QUEUE = 'payroll.generate.details';

// Name of the exchange for routing dead letters
export const DEAD_LETTER_EXCHANGE = 'dlx.exchange';

// Name of the queue where dead letters for payroll jobs end up
export const DEAD_LETTER_QUEUE = 'dlx.payroll.generate.details';