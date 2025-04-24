import { Router } from 'express';
import { UserRole } from '@prisma/client';
import { employeeController } from './employee.controller';
import { validate } from '../../middleware/validate'; // Assuming validation middleware exists
import { authMiddleware, authorize } from '../../middleware/authMiddleware'; // Assuming auth middleware exists
import {
    createEmployeeSchema,
    updateEmployeeSchema,
    employeeIdParamSchema,
    getEmployeesQuerySchema
} from './employee.validation';


const router = Router();

// Apply authentication middleware to all employee routes
router.use(authMiddleware);
router.use(authorize([UserRole.ADMIN])); 

router.route('/')
      .post(
    validate(createEmployeeSchema), 
        employeeController.createEmployee
    )
    .get(
    validate(getEmployeesQuerySchema), 
        employeeController.getEmployees
);

router.route('/:employeeId')
    .get(
    validate(employeeIdParamSchema), // Validate employeeId in URL params
        employeeController.getEmployeeById
    )
    .patch(
    validate(updateEmployeeSchema), // Validate URL params and request body
    employeeController.updateEmployee
    )
    .delete(

    validate(employeeIdParamSchema), // Validate employeeId in URL params
    employeeController.deleteEmployee // Soft delete
);

export const employeeRouter =  router;
