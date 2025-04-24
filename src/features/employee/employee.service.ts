import { PrismaClient, Employee, Prisma } from '@prisma/client';
import { CreateEmployeeInput, UpdateEmployeeInput, GetEmployeesQueryInput } from './employee.validation';
import { ApiError } from '../../utils/ApiError';
import httpStatus from 'http-status-codes';
import { prisma } from '../../lib/prisma'; // Assuming prisma client instance is exported from here

export class EmployeeService {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = prisma;
  }

  /**
   * Creates a new employee record for a given company.
   * @param companyId - The ID of the company the employee belongs to.
   * @param employeeData - Validated data for the new employee.
   * @returns The newly created employee object.
   * @throws ApiError if an employee with the same email already exists in the company.
   */
  async createEmployee(companyId: string, employeeData: CreateEmployeeInput): Promise<Employee> {
    // Check if an employee with this email already exists within the same company using the composite key
    const existingEmployee = await this.prisma.employee.findUnique({
      where: {
        email_companyId: {
          email: employeeData.email,
          companyId: companyId,
        },
      },
    });

    if (existingEmployee) {
      throw new ApiError(httpStatus.CONFLICT, 'An employee with this email already exists in this company.');
    }

    // Convert number inputs potentially coming as strings/numbers to Decimal
    const salaryDecimal = employeeData.salary ? new Prisma.Decimal(employeeData.salary) : null;
    const payRateDecimal = employeeData.payRate ? new Prisma.Decimal(employeeData.payRate) : null;

    // Separate base data from relational connection data
    const dataToCreate: Prisma.EmployeeUncheckedCreateInput = {
        firstName: employeeData.firstName,
        lastName: employeeData.lastName,
        email: employeeData.email,
        employmentType: employeeData.employmentType,
        payType: employeeData.payType,
        salary: salaryDecimal,
        payRate: payRateDecimal,
        companyId: companyId, // Connect company directly via ID
        userId: employeeData.userId || null, // Assign userId directly or null
        // isActive defaults to true in schema
    };


    try {
      const newEmployee = await this.prisma.employee.create({
        data: dataToCreate,
      });
      return newEmployee;
    } catch (error) {
       if (error instanceof Prisma.PrismaClientKnownRequestError) {
         // Handle potential DB constraints errors, e.g., foreign key violation if userId is invalid
         if (error.code === 'P2002') { // Unique constraint violation (likely email if not checked above)
             throw new ApiError(httpStatus.CONFLICT, 'Employee with this email already exists.');
         }
         if (error.code === 'P2025') { // Record not found (e.g., invalid userId or companyId)
             throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid user or company reference.');
         }
       }
      // Log the error for debugging
      console.error("Error creating employee:", error);
      throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to create employee.');
    }
  }

  /**
   * Retrieves a single employee by their ID, ensuring they belong to the specified company.
   * @param companyId - The ID of the company.
   * @param employeeId - The ID of the employee to retrieve.
   * @returns The employee object or null if not found.
   */
  async getEmployeeById(companyId: string, employeeId: string): Promise<Employee | null> {
    return this.prisma.employee.findUnique({
      where: {
        id: employeeId,
        companyId: companyId, // Ensure employee belongs to the correct company
      },
    });
  }

  /**
   * Retrieves a list of employees for a company with pagination, sorting, and filtering.
   * @param companyId - The ID of the company.
   * @param queryParams - Options for filtering, sorting, and pagination.
   * @returns An object containing the list of employees and pagination metadata.
   */
  async getEmployees(companyId: string, queryParams: GetEmployeesQueryInput) {
    const { limit = 10, page = 1, isActive, sortBy = 'createdAt', sortOrder = 'desc', search } = queryParams;
    const skip = (page - 1) * limit;

    const where: Prisma.EmployeeWhereInput = {
      companyId: companyId,
      ...(isActive !== undefined && { isActive }), // Filter by active status if provided
      ...(search && { // Basic search across first name, last name, email
        OR: [
          { firstName: { contains: search, mode: 'insensitive' } },
          { lastName: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const employees = await this.prisma.employee.findMany({
      where,
      skip,
      take: limit,
      orderBy: {
        [sortBy]: sortOrder,
      },
    });

    const totalEmployees = await this.prisma.employee.count({ where });

    return {
      data: employees,
      meta: {
        total: totalEmployees,
        page,
        limit,
        totalPages: Math.ceil(totalEmployees / limit),
      },
    };
  }

  /**
   * Updates an existing employee's details.
   * @param companyId - The ID of the company.
   * @param employeeId - The ID of the employee to update.
   * @param updateData - Validated data containing the fields to update.
   * @returns The updated employee object.
   * @throws ApiError if the employee is not found or belongs to a different company.
   */
  async updateEmployee(companyId: string, employeeId: string, updateData: UpdateEmployeeInput): Promise<Employee> {
     // First, verify the employee exists and belongs to the company
     const existingEmployee = await this.getEmployeeById(companyId, employeeId);
     if (!existingEmployee) {
       throw new ApiError(httpStatus.NOT_FOUND, 'Employee not found or does not belong to this company.');
     }

     // Convert number inputs potentially coming as strings/numbers to Decimal
     const salaryDecimal = updateData.salary !== undefined ? (updateData.salary === null ? null : new Prisma.Decimal(updateData.salary)) : undefined;
     const payRateDecimal = updateData.payRate !== undefined ? (updateData.payRate === null ? null : new Prisma.Decimal(updateData.payRate)) : undefined;


     // Prevent changing email to one that already exists in the company (if email is being updated)
     if (updateData.email && updateData.email !== existingEmployee.email) {
        const conflictingEmployee = await this.prisma.employee.findFirst({
            where: {
                email: updateData.email,
                companyId: companyId,
                id: { not: employeeId } // Exclude the current employee
            }
        });
        if (conflictingEmployee) {
            throw new ApiError(httpStatus.CONFLICT, 'Another employee with this email already exists in this company.');
        }
     }

     // Construct the update data object carefully
     const dataToUpdate: Prisma.EmployeeUpdateInput = {
        ...updateData, // Spread validated fields first
        // Handle optional Decimal conversions
        ...(salaryDecimal !== undefined && { salary: salaryDecimal }),
        ...(payRateDecimal !== undefined && { payRate: payRateDecimal }),
        // Handle userId update: set directly to ID or null
        ...(updateData.userId !== undefined && { userId: updateData.userId }),
     };
     // Remove userId from the spread data if it was handled separately to avoid type issues
     // Also remove properties that are relations or handled separately
     delete (dataToUpdate as any).userId;


    try {
      const updatedEmployee = await this.prisma.employee.update({
        where: {
          id: employeeId,
          companyId: companyId, // Ensure update is scoped to the company
        },
        data: dataToUpdate,
      });
      return updatedEmployee;
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
         // Handle potential DB constraints errors
         if (error.code === 'P2002') { // Unique constraint violation (likely email)
             throw new ApiError(httpStatus.CONFLICT, 'Employee with this email already exists.');
         }
         if (error.code === 'P2025') { // Record not found (e.g., invalid userId for connect)
             throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid reference during update (e.g., user ID).');
         }
       }
      // Log the error
      console.error("Error updating employee:", error);
      throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to update employee.');
    }
  }

  /**
   * Soft deletes an employee by setting their `isActive` status to false.
   * @param companyId - The ID of the company.
   * @param employeeId - The ID of the employee to deactivate.
   * @returns The updated employee object with isActive set to false.
   * @throws ApiError if the employee is not found or already inactive.
   */
  async deleteEmployee(companyId: string, employeeId: string): Promise<Employee> {
    const employee = await this.getEmployeeById(companyId, employeeId);

    if (!employee) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Employee not found or does not belong to this company.');
    }

    if (!employee.isActive) {
       throw new ApiError(httpStatus.BAD_REQUEST, 'Employee is already inactive.');
    }

    try {
        return await this.prisma.employee.update({
            where: {
                id: employeeId,
                companyId: companyId,
            },
            data: {
                isActive: false,
            },
        });
    } catch (error) {
         // Log the error
         console.error("Error deactivating employee:", error);
         throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to deactivate employee.');
    }
  }
}

// Export an instance or the class itself depending on your DI strategy
export const employeeService = new EmployeeService();
