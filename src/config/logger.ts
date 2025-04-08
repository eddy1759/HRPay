import pino from 'pino';
import env from './env';

const logger = pino({
	level: env.LOG_LEVEL,
	transport:
		env.NODE_ENV === 'development'
			? { target: 'pino-pretty' } // Human-readable logs in dev
			: undefined, // Default JSON logs in production
});

export default logger;
