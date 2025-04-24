import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { asyncWrapper } from '../../utils/asyncWrapper';
import { PayrollService } from './payroll.service';
import { ApiError } from '../../utils/ApiError';
import { AuthRequest } from '@/middleware/authMiddleware'; 
import { langchainReportService } from '../ai/langchain-report.service'; // Import the AI service
import logger from '@/config/logger'; // Import logger


/**
 * @desc    Create a new draft payroll
 * @route   POST /api/v1/payrolls
 * @access  Private (Admin)
 */
const createPayroll = asyncWrapper(async (req: AuthRequest, res: Response) => {
    
    const { periodStart, periodEnd } = req.body;
    const generatedById = req.user?.id;
    console.log("periodStart", periodStart, "periodEnd", periodEnd, "generatedById", generatedById);
    const companyId = req.user.companyId; // Assuming companyId is available on req
    console.log("companyId", companyId);

    if (!generatedById || !companyId) {
        throw new ApiError(StatusCodes.UNAUTHORIZED, 'Authentication or company context missing.');
    }

    const payroll = await PayrollService.createPayroll(
        companyId,
        new Date(periodStart),
        new Date(periodEnd),
        generatedById
    );
    res.status(StatusCodes.ACCEPTED).json({ success: true, message: "Payroll creation initiated, calculation queued.", data: payroll });
});

/**
 * @desc    Approve a draft payroll
 * @route   PATCH /api/v1/payrolls/:payrollId/approve
 * @access  Private (Admin)
 */
const approvePayroll = asyncWrapper(async (req: AuthRequest, res: Response) => {
    
    const { payrollId } = req.params;
    const approvedById = req.user?.id;

    if (!approvedById) {
        throw new ApiError(StatusCodes.UNAUTHORIZED, 'User not authenticated.');
    }

    const payroll = await PayrollService.approvePayroll(payrollId, approvedById);
    res.status(StatusCodes.OK).json({ success: true, data: payroll });
});


/**
 * @desc    Mark an approved payroll as paid
 * @route   PATCH /api/v1/payrolls/:payrollId/pay
 * @access  Private (Admin)
 */
const payPayroll = asyncWrapper(async (req: AuthRequest, res: Response) => {
    
    const { payrollId } = req.params;
    const { paymentDate } = req.body; // Expect paymentDate in the request body
    const paidById = req.user?.id;

    if (!paidById) {
        throw new ApiError(StatusCodes.UNAUTHORIZED, 'User not authenticated.');
    }

    const payroll = await PayrollService.payPayroll(payrollId, paidById, new Date(paymentDate));
    res.status(StatusCodes.OK).json({ success: true, data: payroll });
});

/**
 * @desc    Get a single payroll by ID
 * @route   GET /api/v1/payrolls/:payrollId
 * @access  Private (Admin/Employee - depending on access rules)
 */
const getPayrollById = asyncWrapper(async (req: AuthRequest, res: Response) => {
    const { payrollId } = req.params;
    // Optional: Add access control logic here - check if user's company matches payroll's company
    const companyId = req.user.companyId;

    if (!companyId) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'Company context not found.');
    }

    const payroll = await PayrollService.getPayrollById(payrollId, companyId);

    if (!payroll) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Payroll not found.');
    }

    res.status(StatusCodes.OK).json({ success: true, data: payroll });
});


/**
 * @desc    Get all payrolls for the user's company
 * @route   GET /api/v1/payrolls
 * @access  Private (Admin)
 */
const getPayrolls = asyncWrapper(async (req: AuthRequest, res: Response) => {
    const companyId = req.user.companyId;
    const { status, page = 1, limit = 20 } = req.query as any;// Optional query param for filtering

     if (!companyId) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'Company context not found.');
    }

    const pageNumber = parseInt(page as string, 10);
    const limitNumber = parseInt(limit as string, 10);

    const result = await PayrollService.getPayrollsByCompany(
        companyId,
        status, // Status is already validated PayrollStatus or undefined
        pageNumber > 0 ? pageNumber : 1, // Ensure positive page number
        limitNumber > 0 && limitNumber <= 100 ? limitNumber : 20 // Ensure valid limit
        );

    res.status(StatusCodes.OK).json({
        success: true,
        count: result.payrolls.length,
        totalCount: result.totalCount,
        totalPages: result.totalPages,
        currentPage: pageNumber,
        data: result.payrolls
    });
});




/**
 * @desc    Get AI-powered insights based on a natural language query
 * @route   POST /api/v1/payrolls/insights
 * @access  Private (Admin)
 */
const getPayrollInsights = asyncWrapper(async (req: AuthRequest, res: Response) => {
    const { query } = req.body;
    const companyId = req.user.companyId;
    const userId = req.user.id;

    if (!companyId || !userId) {
        throw new ApiError(StatusCodes.UNAUTHORIZED, 'Company context or user authentication missing.');
    }
   

    try {
        logger.info(`Generating payroll insight for company ${companyId} with query: "${query}"`);
        // Pass necessary context to the AI service
        const report = await langchainReportService.generateReport(query, companyId);

        res.status(StatusCodes.OK).json({ success: true, data: { insight: report } });
    } catch (error: any) {
        logger.error(`Error generating payroll insight for company ${companyId}: ${error.message}`, { error });
        // Provide a generic error to the user, but log specifics
        throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'Failed to generate payroll insights.');
    }
});


export const PayrollController = {
    createPayroll,
    approvePayroll,
    payPayroll,
    getPayrollById,
    getPayrolls,
    getPayrollInsights, // Add the new method here
};
