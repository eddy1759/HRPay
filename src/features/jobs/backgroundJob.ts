import { startEmailJobProcessor } from './emailJob.processor'
import { startPayrollJobProcessor } from './payrollJob.processor'
import logger from '../../config/logger'


export const startBackgroundJobs = async () => {
    try {
        await Promise.all([
            startEmailJobProcessor(), // Start the email job processor
            startPayrollJobProcessor(), // Start the payroll job processor
        ])
        logger.info('All background processes started successfully.');
    } catch (error) {
        logger.error('Error starting background jobs:', error);
        throw error; // Rethrow to propagate the error
    }
}