import { Prisma, Company, UserRole } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import logger from '@/config/logger';
import { ConflictError, InternalServerError, NotFoundError, ForbiddenError, BadRequestError, ApiError } from '@/utils/ApiError';
import { CreateCompanyInput, UpdateCompanyInput } from './company.validation';
import { AuthenticatedUser } from '@/middleware/authMiddleware'; // Assuming this type exists


const ensureSuperAdmin = (currentUser: AuthenticatedUser) => {
    if (currentUser.role !== UserRole.SUPER_ADMIN) {
        throw new ForbiddenError('This action requires SUPER_ADMIN privileges.');
    }
};

class CompanyService {
    constructor(private prismaClient: Prisma.TransactionClient | typeof prisma = prisma) {}

    async createCompany(data: CreateCompanyInput, currentUser: AuthenticatedUser): Promise<Company> {
        ensureSuperAdmin(currentUser); 

        const lowerCaseEmail = data.email.toLowerCase();
        // Check uniqueness
        const existing = await this.prismaClient.company.findFirst({
            where: { OR: [{ email: lowerCaseEmail }, { name: data.name }] },
            select: { id: true },
        });

        if (existing) {
            throw new ConflictError('A company with this name or email already exists.');
        }

        try {
            const company = await this.prismaClient.company.create({
                data: { name: data.name, email: lowerCaseEmail },
            });

            logger.info(`Company created: ${company.id} by User: ${currentUser.id}`);
            return company;
        } catch (error) {
            logger.error({ err: error, inputData: data }, 'Error creating company');
             if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                 throw new ConflictError('A company with this name or email already exists (race condition).');
             }
            throw new InternalServerError('Failed to create company.');
        }
    }

    async listCompanies(page: number, limit: number, currentUser: AuthenticatedUser): Promise<{ items: Company[], total: number }> {

        ensureSuperAdmin(currentUser); // Only Super Admin can list all companies initially

        const skip = (page - 1) * limit;
        const take = limit;

        try {
            const [items, total] = await Promise.all([
                this.prismaClient.company.findMany({
                    skip,
                    take,
                    orderBy: { name: 'asc' },
                }),
                this.prismaClient.company.count(),
            ]);
            return { items, total };
        } catch (error) {
            logger.error({ err: error }, 'Error listing companies');
            throw new InternalServerError('Failed to retrieve companies.');
        }
    }

    async getCompanyById(companyId: string, currentUser: AuthenticatedUser): Promise<Company> {
        // Allow SUPER_ADMIN or users belonging to the company (if applicable later)
         if (currentUser.role !== UserRole.SUPER_ADMIN /* && currentUser.companyId !== companyId */ ) {
             // Modify this check based on who should be allowed to GET a company by ID
             // For now, restrict to SUPER_ADMIN for simplicity, assuming no self-service company view yet
             throw new ForbiddenError('Access denied.');
         }

        const company = await this.prismaClient.company.findUnique({
            where: { id: companyId },
        });
        if (!company) {
            throw new NotFoundError(`Company with ID ${companyId} not found.`);
        }
        return company;
    }

    async updateCompany(companyId: string, data: UpdateCompanyInput, currentUser: AuthenticatedUser): Promise<Company> {
        ensureSuperAdmin(currentUser); // Only Super Admin can update

        // Check if company exists first
        const existingCompany = await this.prismaClient.company.findUnique({ where: { id: companyId }, select: { id: true } });

        if (!existingCompany) {
            throw new NotFoundError(`Company with ID ${companyId} not found.`);
        }

        // Check email uniqueness if email is being updated
        if (data.email) {
            const lowerCaseEmail = data.email.toLowerCase();
            const conflictingCompany = await this.prismaClient.company.findUnique({
                where: { email: lowerCaseEmail },
                select: { id: true }
            });

            if (conflictingCompany && conflictingCompany.id !== companyId) {
                 throw new ConflictError(`Email ${data.email} is already in use by another company.`);
            }

            data.email = lowerCaseEmail; // Use lowercased version for update
        }


        try {
            const updatedCompany = await this.prismaClient.company.update({
                where: { id: companyId },
                data: data,
            });

            logger.info(`Company updated: ${updatedCompany.id} by User: ${currentUser.id}`);
            return updatedCompany;
        } catch (error) {
            logger.error({ err: error, companyId, updateData: data }, 'Error updating company');
             if (error instanceof Prisma.PrismaClientKnownRequestError) {
                  if (error.code === 'P2002') {
                      throw new ConflictError('Update failed: Email is already in use (race condition).');
                  }
                   if (error.code === 'P2025') {
                       throw new NotFoundError(`Company with ID ${companyId} not found during update.`);
                   }
             }
            throw new InternalServerError('Failed to update company.');
        }
    }

     async deleteCompany(companyId: string, currentUser: AuthenticatedUser): Promise<void> {
         ensureSuperAdmin(currentUser); // Only Super Admin can delete

         // Check existence first
          const existingCompany = await this.prismaClient.company.findUnique({ where: { id: companyId }, select: { id: true } });
          if (!existingCompany) {
              throw new NotFoundError(`Company with ID ${companyId} not found.`);
          }

         try {
             await this.prismaClient.company.delete({
                 where: { id: companyId },
             });
             logger.info(`Company deleted: ${companyId} by User: ${currentUser.id}`);
         } catch (error) {
              logger.error({ err: error, companyId }, 'Error deleting company');
             if (error instanceof Prisma.PrismaClientKnownRequestError) {
                   if (error.code === 'P2014' || error.code === 'P2003') {
                        logger.warn(`Attempted to delete company ${companyId} with existing relations (Employees/Payrolls).`);
                        throw new ConflictError('Cannot delete company: It has associated employees or payroll history.');
                   }
                   if (error.code === 'P2025') {
                       throw new NotFoundError(`Company with ID ${companyId} not found during delete operation.`);
                   }
             }
             throw new InternalServerError('Failed to delete company.');
         }
     }
}

export const companyService = new CompanyService();