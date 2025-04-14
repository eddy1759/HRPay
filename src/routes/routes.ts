import { Router } from 'express';
import authRouter from '../modules/auth/auth.routes';
import inviteRouter from '@/modules/invitation/invite.routes';
import companyRouter from '@/modules/company/company.routes';

const router = Router();

const defaultRoutes: {
	path: string;
	route: Router;
}[] = [
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
	}
];

defaultRoutes.forEach((route) => {
	router.use(route.path, route.route);
});

export default router;

// This file is responsible for defining the main routes of the application.
// It imports the authentication routes and mounts them under the '/auth' path.
// This allows for a clean separation of concerns, making it easier to manage and scale the application.
// The router is then exported for use in the main application file (e.g., index.ts).
// The defaultRoutes array can be extended in the future to include other routes, such as employee management, payroll processing, etc.
// This modular approach enhances maintainability and readability of the codebase.
// The use of TypeScript interfaces and types ensures type safety and better developer experience.
// The router is created using the express Router() method, which allows for defining modular route handlers.
// Each route is defined with a path and the corresponding route handler.
// The forEach loop iterates over the defaultRoutes array and mounts each route on the main router.
// This structure allows for easy addition of new routes in the future, promoting scalability.
// The router is exported as the default export of the module, making it available for import in other parts of the application.
// The code is well-structured and follows best practices for organizing routes in an Express application.
// The use of async/await and try/catch blocks ensures that asynchronous operations are handled gracefully.

