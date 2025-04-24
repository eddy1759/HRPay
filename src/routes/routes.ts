import { Router } from 'express';

import authRouter from '@/features/auth/auth.routes';
import inviteRouter from '@/features/invitation/invite.routes';
import companyRouter from '@/features/company/company.routes';
import { payrollRouter } from '@/features/payroll/payroll.routes';
import { employeeRouter } from '@/features/employee/employee.routes';
import leaveRouter from '@/features/leave/leave.routes'; 


/**
 * @module apiRouter
 * @description The main application router.
 *
 * This module aggregates all feature-specific routers and mounts them
 * under their respective base paths. This centralizes route definition
 * and promotes a clean, modular application structure.
 */
const router = Router();

/**
 * @typedef {Object} RouteConfig
 * @property {string} path - The base path where the router will be mounted (e.g., '/auth').
 * @property {Router} route - The Express Router instance for the specific feature.
 */

/**
 * @description Array defining the configuration for each feature router,
 * specifying the base path and the router instance to use.
 * @type {RouteConfig[]}
 */
const featureRoutes = [
    {
        path: '/auth',
        route: authRouter,
    },
    {
        path: '/invites',
        route: inviteRouter,
    },
    {
        path: '/companies',
        route: companyRouter,
    },
    {
        path: '/payrolls',
        route: payrollRouter,
    },
    {
        path: '/employees',
        route: employeeRouter,
    },
    {
        path: '/leave',
        route: leaveRouter,
    },
];


/**
 * @description Iterates through the featureRoutes array and mounts each
 * feature router onto the main application router at its defined path.
 * This process essentially builds the complete API route structure.
 */
featureRoutes.forEach((route) => {
    router.use(route.path, route.route);
});

/**
 * @description Exports the main application router, configured with all
 * feature-specific routes mounted.
 * @exports default
 */
export default router;

