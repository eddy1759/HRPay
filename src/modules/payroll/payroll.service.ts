import { Prisma, Payroll, EmployeePayroll, Employee, Company, UserRole, PayrollStatus, PrismaClient, User } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library'

import logger from '@/config/logger';
import { prisma } from '@/lib/prisma';
import { AuthenticatedUser } from '@/middleware/authMiddleware';
import { GeneratePayrollInput, PayrollHistoryQuery, PayrollReportQuery } from './payroll.validation';
import { ConflictError, InternalServerError, NotFoundError, ForbiddenError, BadRequestError, ApiError } from '@/utils/ApiError';


// Placeholder for Langchain Integration - Create a separate service for this
// import { langchainReportService } from '@/services/langchainReportService';

const MANAGER_ROLES = [UserRole.ADMIN, UserRole.SUPER_ADMIN];

export class PayrollService {
    constructor(private prismaClient: PrismaClient = prisma) { }

     // --- Permission Helper (moved from invite service example, adapt as needed) ---
     private async _validateManagerPermissions(userId: string, targetCompanyId: string, allowedRoles: UserRole[] = = MANAGER_ROLES): Promise<User> {

        const user = await this.prismaClient.user.findUnique({ where: { id: userId } });

        if (!user) throw new NotFoundError(`User ${userId} performing action not found.`);
        
        if (user.role !== UserRole.SUPER_ADMIN && user.companyId !== targetCompanyId) {
            throw new ForbiddenError('You do not have permission to manage resources for this company.');
        }
        if (!allowedRoles.includes(user.role)) {
            throw new ForbiddenError(`Your role (${user.role}) does not permit this action.`);
        }
        return user;
    }

    /**
     * Generates a new Payroll run for a given period and company.
     * Calculates details for eligible employees.
     * IMPORTANT: Calculation logic here is highly simplified. Real-world payroll is complex.
     * Consider using background jobs for long-running payroll generation.
     */
    async generatePayrollRun(input: GeneratePayrollInput, currentUser: AuthenticatedUser): Promise<Payroll> {
        await this._validateManagerPermissions(currentUser.id, input.companyId);

        const { companyId, periodStart, periodEnd } = input;

        // --- 1. Fetch Eligible Employees ---
        // TODO: Add more criteria (e.g., hired before periodEnd, active status)
        const employees = await this.prismaClient.employee.findMany({
            where: {
                companyId: companyId,
                // Add filters like: startDate <= periodEnd, status: 'ACTIVE' etc.
            },
        });

        if (employees.length === 0) {
            throw new BadRequestError('No eligible employees found for this period in the specified company.');
        }

        logger.info(`Generating payroll for ${employees.length} employees, Company: ${companyId}, Period: ${periodStart.toISOString()} - ${periodEnd.toISOString()}`);

        // --- 2. Perform Calculations & Prepare Data (Simplified Example) ---
        let overallTotal = new Decimal(0);
        const employeePayrollDetails: Prisma.EmployeePayrollCreateManyPayrollInput[] = [];

        for (const employee of employees) {
            // --- TODO: Implement REAL Payroll Calculation Logic ---
            // This requires fetching rules for taxes, deductions, benefits, overtime etc.
            // Based on employee data, company settings, and regulations 
            // This example uses basic salary only.
            const grossAmount = employee.salary; // Highly simplified - needs pro-rating, overtime etc.
            const deductions = new Decimal(0); // Highly simplified - add taxes (PAYE), pension, etc.
            const netAmount = grossAmount.minus(deductions);
            // --- End Simplified Calculation ---

            if (netAmount.lessThan(0)) {
                 logger.warn(`Calculated negative net amount for employee ${employee.id}. Check calculations/salary.`);
                 // Decide how to handle: skip employee, set net to 0, throw error?
                 // Continue for now, but real system needs robust handling.
            }

            employeePayrollDetails.push({
                employeeId: employee.id,
                grossAmount,
                deductions,
                netAmount,
                // No need to specify payrollId here, done via createMany relation
            });
            overallTotal = overallTotal.plus(netAmount);
        }

        // --- 3. Create Payroll and Details in Transaction ---
        try {
            const newPayroll = await this.prismaClient.payroll.create({
                data: {
                    companyId: companyId,
                    periodStart: periodStart,
                    periodEnd: periodEnd,
                    status: PayrollStatus.DRAFT, // Start as draft
                    totalAmount: overallTotal, // Store calculated total
                    // processedAt will be set when paid/approved
                    details: {
                        createMany: { // Efficiently create all details
                            data: employeePayrollDetails,
                        },
                    },
                },
                 include: { // Optionally include details in the response
                     details: { include: { employee: { select: { id: true, firstName: true, lastName: true } } } }
                 }
            });
            logger.info(`Payroll ${newPayroll.id} generated successfully with ${employeePayrollDetails.length} details.`);
            return newPayroll;
        } catch (error) {
             logger.error({ err: error, input }, 'Failed to create payroll run in transaction');
             if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                  // Could be unique constraint on EmployeePayroll (employeeId, payrollId) if run concurrently?
                  throw new ConflictError('Failed to generate payroll details. Please try again.');
             }
             throw new InternalServerError('Failed to save generated payroll.');
        }
        // NOTE: For long runs, initiate a background job here and return 202 Accepted.
    }

    /**
     * Retrieves a paginated list of past payrolls for a company, with filtering.
     */
    async getPayrollHistory(query: PayrollHistoryQuery, currentUser: AuthenticatedUser): Promise<{ items: Payroll[], total: number }> {
        await this._validateManagerPermissions(currentUser.id, query.companyId);

        const { companyId, status, startDate, endDate, page, limit } = query;
        const skip = (page - 1) * limit;
        const take = limit;

        const where: Prisma.PayrollWhereInput = {
            companyId: companyId,
            ...(status && { status: status }),
            // Add date filtering - decide which date field to filter on (e.g., processedAt or periodEnd)
            ...(startDate && endDate && { periodEnd: { gte: startDate, lte: endDate } }), // Example: filter by periodEnd
            ...(startDate && !endDate && { periodEnd: { gte: startDate } }),
            ...(!startDate && endDate && { periodEnd: { lte: endDate } }),
        };

        try {
            const [items, total] = await this.prismaClient.$transaction([
                this.prismaClient.payroll.findMany({
                    where,
                    skip,
                    take,
                    orderBy: { periodEnd: 'desc' }, // Order by most recent first
                    // include: { company: { select: { name: true } } } // Optionally include related data
                }),
                this.prismaClient.payroll.count({ where }),
            ]);
            return { items, total };
        } catch (error) {
            logger.error({ err: error, query }, 'Error fetching payroll history');
            throw new InternalServerError('Failed to retrieve payroll history.');
        }
    }

    /**
     * Generates a report based on a natural language query using LangChain.
     * Placeholder implementation - Requires actual LangChain setup.
     */
    async generatePayrollReport(query: PayrollReportQuery, currentUser: AuthenticatedUser): Promise<any> {
        await this._validateManagerPermissions(currentUser.id, query.companyId);

        const { companyId, naturalLanguageQuery, startDate, endDate } = query;

        logger.info(`Generating report for Company: ${companyId}, Query: "${naturalLanguageQuery}"`);

        // --- TODO: LangChain Integration ---
        // This is highly dependent on your LangChain setup (Agents, Chains, LLMs)

        // Option A: SQL Agent (Requires secure DB access for LangChain)
        // 1. Instantiate LangChain SQL Agent with Prisma connection/schema info.
        // 2. Sanitize naturalLanguageQuery to prevent injection into agent prompts.
        // 3. Run the agent: result = await sqlAgent.run(sanitizedQuery + " Filter for companyId " + companyId + date context);
        // 4. Parse/format the result.

        // Option B: Direct LLM Call with Context
        // 1. Fetch relevant aggregated data from Prisma based on query hints/dates/companyId.
        //    E.g., monthly totals, employee counts, etc.
        //    const dataContext = await prisma.payroll.aggregate(...)
        // 2. Construct a detailed prompt including the sanitized naturalLanguageQuery and the dataContext.
        // 3. Call your chosen LLM API (e.g., Gemini, OpenAI) with the prompt.
        // 4. Parse the LLM's response to extract the report data/summary.

        // Option C: Pandas Agent (Load data into DataFrame first)
        // 1. Fetch necessary data.
        // 2. Load into Pandas DataFrame.
        // 3. Instantiate Pandas Agent.
        // 4. Run agent with sanitized query.

        // --- Placeholder Response ---
        try {
            // Replace with actual LangChain call
            // Example conceptual call:
            // const reportResult = await langchainReportService.generate({
            //     companyId,
            //     query: naturalLanguageQuery, // Ensure sanitization happens inside the service
            //     startDate,
            //     endDate,
            // });
             const reportResult = {
                  summary: `Report generated based on query: "${naturalLanguageQuery}". (LangChain integration needed)`,
                  data: [
                     { month: "2025-01", totalPaid: 500000 },
                     { month: "2025-02", totalPaid: 510000 },
                     // ... more data based on query ...
                 ]
             }; // Dummy data

             logger.info(`Report generated successfully for Company: ${companyId}`);
            return reportResult;

        } catch (error) {
             logger.error({ err: error, query }, 'Error generating payroll report via LangChain');
             // Handle specific LangChain/LLM errors if possible
             throw new InternalServerError('Failed to generate report.');
        }
        // --- End Placeholder ---
    }

     // --- Add Basic CRUD for Payroll (Get, Update Status, Delete Draft) ---
     async getPayrollById(payrollId: string, companyId: string, currentUser: AuthenticatedUser): Promise<Payroll | null> {
         await this._validateManagerPermissions(currentUser.id, companyId);
         const payroll = await this.prismaClient.payroll.findFirst({
             where: { id: payrollId, companyId: companyId },
             // include: { details: true } // Optionally include details
         });
         if (!payroll) throw new NotFoundError(`Payroll run ${payrollId} not found in company ${companyId}.`);
         return payroll;
     }

     async updatePayrollStatus(payrollId: string, companyId: string, status: PayrollStatus, currentUser: AuthenticatedUser): Promise<Payroll> {
         await this._validateManagerPermissions(currentUser.id, companyId);
         // TODO: Add business logic validation (e.g., allowed status transitions)
         try {
              const updatedPayroll = await this.prismaClient.payroll.update({
                  where: { id_companyId: { id: payrollId, companyId: companyId } }, // Use compound key if defined or fetch first
                  data: { status: status, ...(status === PayrollStatus.PAID && { processedAt: new Date() }) }, // Set processedAt when PAID
              });
              logger.info(`Payroll ${payrollId} status updated to ${status} by User ${currentUser.id}`);
              return updatedPayroll;
         } catch (error) {
              logger.error({ err: error, payrollId, status }, 'Failed to update payroll status');
              if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
                   throw new NotFoundError(`Payroll run ${payrollId} not found.`);
              }
               throw new InternalServerError('Failed to update payroll status.');
         }
     }

      async deleteDraftPayroll(payrollId: string, companyId: string, currentUser: AuthenticatedUser): Promise<void> {
          await this._validateManagerPermissions(currentUser.id, companyId);
          const payroll = await this.prismaClient.payroll.findFirst({
              where: { id: payrollId, companyId: companyId },
              select: { status: true }
          });
           if (!payroll) throw new NotFoundError(`Payroll run ${payrollId} not found.`);
           if (payroll.status !== PayrollStatus.DRAFT) {
                throw new BadRequestError(`Only DRAFT payroll runs can be deleted. Status is ${payroll.status}.`);
           }

          try {
                // Deleting payroll cascades to EmployeePayroll details due to schema
                await this.prismaClient.payroll.delete({
                    where: { id: payrollId },
                });
                logger.info(`DRAFT Payroll ${payrollId} deleted by User ${currentUser.id}`);
          } catch (error) {
               logger.error({ err: error, payrollId }, 'Failed to delete draft payroll');
               if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
                   throw new NotFoundError(`Payroll run ${payrollId} not found during delete.`);
               }
                throw new InternalServerError('Failed to delete draft payroll.');
          }
      }

}

export const payrollService = new PayrollService();