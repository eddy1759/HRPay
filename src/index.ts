import express, { Request, Response, Application, ErrorRequestHandler } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import createError from 'http-errors';
import httpLogger from './middleware/logger';
import { errorHandler } from './middleware/errorHandler';
import routes from './routes/routes';
import { NotFoundError } from './utils/ApiError';
import logger from './config/logger';
import { checkServerReadiness } from './server/startup';

const app: Application = express();

// --- Middlewares ---

// Security Headers
app.use(helmet());

// Enable CORS - Configure origins properly for production
app.use(cors(/* { origin: 'your-frontend-domain.com' } */));

// Parse JSON request bodies
app.use(express.json());

// Parse URL-encoded request bodies
app.use(express.urlencoded({ extended: true }));

// Request logging (Pino HTTP) - Place early
app.use(httpLogger);

// --- Routes ---
app.get('/', (req: Request, res: Response) => {
	res.send('HR Payroll API is running!');
});

app.get('/service-health', async (req, res) => {
	res.set({
		'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
		Pragma: 'no-cache',
		Expires: '0',
	});
	try {
		const timestamp = new Date().toISOString();
		const readiness = await checkServerReadiness();
		res.status(readiness.overall === 'READY' ? 200 : 500).json({
			...readiness,
			timestamp,
		});
	} catch (error) {
		res.status(500).json({ error: 'Readiness check failed' });
	}
});

// Mount routes
app.use('/api/v1', routes);

// --- Error Handling ---

// Centralized error handler - Must be the LAST middleware
app.use(errorHandler);

app.use(function (req, res, next) {
	next(createError(404));
});

// Handle 404 Not Found for any unspecified routes
app.use((req: Request, res: Response, next) => {
	next(new NotFoundError(`Route not found: ${req.method} ${req.originalUrl}`));
});

// Global error handler
app.use(function (err, req, res, next) {
	// Set locals, only providing error in development
	res.locals.message = err.message;
	res.locals.error = req.app.get('env') === 'development' ? err : {};
	res.status(err.status || 500).end();
} as ErrorRequestHandler);

// Unhandled Rejection and Uncaught Exception handlers
process.on('unhandledRejection', (reason: Error | any, promise: Promise<any>) => {
	logger.fatal(reason, 'Unhandled Rejection at:', promise);
	// Consider graceful shutdown
	process.exit(1);
});

process.on('uncaughtException', (error: Error) => {
	logger.fatal(error, 'Uncaught Exception thrown');
	// Consider graceful shutdown
	process.exit(1);
});

export default app;
