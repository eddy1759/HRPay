import { Request, Response, NextFunction } from 'express';
import { StatusCodes } from 'http-status-codes';
import { companyService } from './company.service';
import { asyncWrapper } from '@/utils/asyncWrapper';
import { AuthRequest } from '@/middleware/authMiddleware'; 
import { getAuthenticatedUser } from '@/utils/auth.utils'; 



const createCompany = asyncWrapper(async (req: AuthRequest, res: Response) => {
    const currentUser = getAuthenticatedUser(req); // Get authenticated user
    const company = await companyService.createCompany(req.body, currentUser); // Body validated by middleware
    res.status(StatusCodes.CREATED).json(company);
});

const listCompanies = asyncWrapper(async (req: AuthRequest, res: Response) => {
    const currentUser = getAuthenticatedUser(req);
    // Query params validated and transformed by middleware
    const { page, limit } = req.query as unknown as { page: number; limit: number };
    const result = await companyService.listCompanies(page, limit, currentUser);
     res.status(StatusCodes.OK).json({
         items: result.items,
         pagination: {
             page,
             limit,
             totalItems: result.total,
             totalPages: Math.ceil(result.total / limit)
         }
     });
});

const getCompany = asyncWrapper(async (req: AuthRequest, res: Response) => {
    const currentUser = getAuthenticatedUser(req);
    const { companyId } = req.params; // Validated by middleware
    const company = await companyService.getCompanyById(companyId, currentUser);
    res.status(StatusCodes.OK).json(company);
});

const updateCompany = asyncWrapper(async (req: AuthRequest, res: Response) => {
    const currentUser = getAuthenticatedUser(req);
    const { companyId } = req.params; // Validated
    const company = await companyService.updateCompany(companyId, req.body, currentUser); // Body validated
    res.status(StatusCodes.OK).json(company);
});

const deleteCompany = asyncWrapper(async (req: AuthRequest, res: Response) => {
    const currentUser = getAuthenticatedUser(req);
    const { companyId } = req.params; // Validated
    await companyService.deleteCompany(companyId, currentUser);
    res.status(StatusCodes.NO_CONTENT).send(); // Standard response for successful DELETE
});


export const companyController = {
    createCompany,
    listCompanies,
    getCompany,
    updateCompany,
    deleteCompany
};