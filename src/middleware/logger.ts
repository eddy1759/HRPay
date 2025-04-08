// src/middleware/logger.ts
import pinoHttp from 'pino-http';
import logger from '../config/logger'; // Import your configured Pino logger instance

// Create pino-http middleware using your existing logger instance
const httpLogger = pinoHttp({
	logger: logger, // Use the shared logger instance

	// Optional: Customize logging further
	// Define custom serializers
	serializers: {
		req(req) {
			// Log only essential request info
			return {
				method: req.method,
				url: req.url,
				// Avoid logging sensitive headers like Authorization
				// headers: req.headers,
				remoteAddress: req.remoteAddress,
			};
		},
		res(res) {
			// Log only essential response info
			return {
				statusCode: res.statusCode,
			};
		},
	},

	// Optional: Customize success/error messages
	customSuccessMessage: function (req, res) {
		return `${req.method} ${req.url} ${res.statusCode} - Request completed`;
	},
	customErrorMessage: function (req, res, err) {
		return `${req.method} ${req.url} ${res.statusCode} - Request failed: ${err.message}`;
	},

	// Optional: Auto-logging level based on status code
	customLogLevel: function (req, res, err) {
		if (res.statusCode >= 400 && res.statusCode < 500) {
			return 'warn';
		} else if (res.statusCode >= 500 || err) {
			return 'error';
		}
		return 'info';
	},
});

export default httpLogger;
