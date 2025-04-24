import express from 'express';
import { validate } from '@/middleware/validate';
import { authMiddleware, authorize } from '@/middleware/authMiddleware'; // Assuming authorize middleware exists
import { UserRole } from '@prisma/client';
import {
    createCompanySchema,
    listCompaniesSchema,
    companyIdParamSchema,
    updateCompanySchema,
} from './company.validation';
import { companyController } from './company.controller';

const comapnyRouter = express.Router();

// Apply auth middleware to all company routes
comapnyRouter.use(authMiddleware);

// Route definitions with validation and authorization
comapnyRouter.post(
    '/',
    authorize([UserRole.SUPER_ADMIN]), // Only SUPER_ADMIN
    validate(createCompanySchema),
    companyController.createCompany
);

comapnyRouter.get(
    '/',
     authorize([UserRole.SUPER_ADMIN]), // Only SUPER_ADMIN for listing all
    validate(listCompaniesSchema),
    companyController.listCompanies
);

comapnyRouter.get(
    '/:companyId',
     authorize([UserRole.SUPER_ADMIN]), // Define who can GET by ID (e.g., SUPER_ADMIN or relevant ADMINs)
    validate(companyIdParamSchema),
    companyController.getCompany
);

comapnyRouter.patch( // Use PATCH for partial updates
    '/:companyId',
    authorize([UserRole.SUPER_ADMIN]), // Only SUPER_ADMIN
    validate(updateCompanySchema),
    companyController.updateCompany
);

comapnyRouter.delete(
    '/:companyId',
    authorize([UserRole.SUPER_ADMIN]), // Only SUPER_ADMIN
    validate(companyIdParamSchema),
    companyController.deleteCompany
);

export default comapnyRouter;