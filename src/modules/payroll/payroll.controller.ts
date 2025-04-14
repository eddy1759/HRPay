import { Request, Response, NextFunction } from 'express';
import { StatusCodes } from 'http-status-codes';
import { payrollService } from './payroll.service';
import { asyncWrapper } from '@/utils/asyncWrapper';
import { AuthRequest } from '@/middleware/authMiddleware';
import { getAuthenticatedUser } from '@/utils/authUtilsHelper'; // Assuming helper exists
import { GeneratePayrollInput, PayrollHistoryQuery, PayrollReportQuery } from './payroll.validation';
import { PayrollStatus } from '@prisma/client';

export const generatePayrollRun = asyncWrapper(async (req: AuthRequest, res: Response) => {
    const currentUser = getAuthenticatedUser(req);
    const inputData: GeneratePayrollInput = req.body; // Validated by middleware

    // Consider returning 202 Accepted if using background jobs
    const payroll = await payrollService.generatePayrollRun(inputData, currentUser);

    res.status(StatusCodes.CREATED).json({
        message: 'Payroll run generated successfully.',
        payrollId: payroll.id,
        status: payroll.status,
        // include payroll object if needed, but might be large with details
    });
});

export const getPayrollHistory = asyncWrapper(async (req: AuthRequest, res: Response) => {
    const currentUser = getAuthenticatedUser(req);
    // Query parameters validated and transformed by middleware
    const query: PayrollHistoryQuery = req.query as unknown as PayrollHistoryQuery;

    // Ensure companyId is present (validation should handle this)
    // Service checks permissions
    const result = await payrollService.getPayrollHistory(query, currentUser);

    res.status(StatusCodes.OK).json({
        items: result.items,
        pagination: {
            page: query.page,
            limit: query.limit,
            totalItems: result.total,
            totalPages: Math.ceil(result.total / query.limit)
        }
    });
});

export const generatePayrollReport = asyncWrapper(async (req: AuthRequest, res: Response) => {
    const currentUser = getAuthenticatedUser(req);
    // Query parameters validated by middleware
    const query: PayrollReportQuery = req.query as unknown as PayrollReportQuery;

    // Service handles permission check and LangChain logic
    const report = await payrollService.generatePayrollReport(query, currentUser);

    res.status(StatusCodes.OK).json(report);
});

// --- Optional Basic CRUD Controllers ---
export const getPayroll = asyncWrapper(async (req: AuthRequest, res: Response) => {
     const currentUser = getAuthenticatedUser(req);
     const { payrollId } = req.params; // Validated
     const { companyId } = req.query as { companyId: string }; // Require companyId for context/permission check

     if (!companyId) throw new BadRequestError('Company ID query parameter is required.');

     const payroll = await payrollService.getPayrollById(payrollId, companyId, currentUser);
     res.status(StatusCodes.OK).json(payroll);
});

export const updatePayrollStatus = asyncWrapper(async (req: AuthRequest, res: Response) => {
      const currentUser = getAuthenticatedUser(req);
      const { payrollId } = req.params; // Validated
      // Get companyId from body or query depending on API design
      const { companyId, status } = req.body as { companyId: string, status: PayrollStatus }; // Assuming in body

       if (!status || !Object.values(PayrollStatus).includes(status)) {
            throw new BadRequestError('Invalid or missing status in request body.');
       }
       if (!companyId) throw new BadRequestError('Company ID is required in request body.');

      const payroll = await payrollService.updatePayrollStatus(payrollId, companyId, status, currentUser);
      res.status(StatusCodes.OK).json(payroll);
});

export const deleteDraftPayroll = asyncWrapper(async (req: AuthRequest, res: Response) => {
       const currentUser = getAuthenticatedUser(req);
       const { payrollId } = req.params; // Validated
       // Get companyId from body or query
        const { companyId } = req.query as { companyId: string }; // Assuming required in query for DELETE

        if (!companyId) throw new BadRequestError('Company ID query parameter is required.');

       await payrollService.deleteDraftPayroll(payrollId, companyId, currentUser);
       res.status(StatusCodes.NO_CONTENT).send();
});