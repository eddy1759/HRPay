import { Response } from 'express';
import httpStatus from 'http-status-codes';
import { employeeService } from './employee.service';
import { CreateEmployeeInput, UpdateEmployeeInput, GetEmployeesQueryInput } from './employee.validation';
import { asyncWrapper } from '../../utils/asyncWrapper'; // Helper to catch async errors
import { ApiError, BadRequestError, UnauthorizedError, ForbiddenError, NotFoundError } from '../../utils/ApiError';
import { AuthRequest } from '../../middleware/authMiddleware';

export class EmployeeController {

    createEmployee = asyncWrapper(async (req: AuthRequest, res: Response) => {
        const companyId = req.user?.companyId;
        if (!companyId) {
            throw new UnauthorizedError( 'User company information is missing.');
        }
        // Validation middleware should have already processed this
        const employeeData = req.body as CreateEmployeeInput;

        const newEmployee = await employeeService.createEmployee(companyId, employeeData);
        res.status(httpStatus.CREATED).json(newEmployee);
    });

    getEmployees = asyncWrapper(async (req: AuthRequest, res: Response) => {
        const companyId = req.user?.companyId;
        if (!companyId) {
            throw new UnauthorizedError('User company information is missing.');
        }
        // Validation middleware should have already processed this
        const queryParams = req.query as unknown as GetEmployeesQueryInput; // Cast after validation

        const result = await employeeService.getEmployees(companyId, queryParams);
        res.status(httpStatus.OK).json(result);
    });

    getEmployeeById = asyncWrapper(async (req: AuthRequest, res: Response) => {
        const companyId = req.user?.companyId;
        const { employeeId } = req.params;

        if (!companyId) {
            throw new UnauthorizedError('User company information is missing.');
        }
        if (!employeeId) {
             throw new BadRequestError('Employee ID is required.');
        }

        const employee = await employeeService.getEmployeeById(companyId, employeeId);
        if (!employee) {
            throw new NotFoundError('Employee not found.');
        }
        res.status(httpStatus.OK).json(employee);
    });

    updateEmployee = asyncWrapper(async (req: AuthRequest, res: Response) => {
        const companyId = req.user?.companyId;
        const { employeeId } = req.params;
         // Validation middleware should have already processed this
        const updateData = req.body as UpdateEmployeeInput;

        if (!companyId) {
            throw new UnauthorizedError('User company information is missing.');
        }
         if (!employeeId) {
             throw new BadRequestError( 'Employee ID is required.');
        }

        const updatedEmployee = await employeeService.updateEmployee(companyId, employeeId, updateData);
        res.status(httpStatus.OK).json(updatedEmployee);
    });

    deleteEmployee = asyncWrapper(async (req: AuthRequest, res: Response) => {
        const companyId = req.user?.companyId;
        const { employeeId } = req.params;

         if (!companyId) {
            throw new UnauthorizedError( 'User company information is missing.');
        }
         if (!employeeId) {
             throw new BadRequestError( 'Employee ID is required.');
        }

        await employeeService.deleteEmployee(companyId, employeeId);
        res.status(httpStatus.NO_CONTENT).send();
    });
}

// Export an instance
export const employeeController = new EmployeeController();
