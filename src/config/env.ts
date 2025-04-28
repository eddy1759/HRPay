import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
	SERVICE_NAME: z.string().default('Payroll Pro'),
	NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
	LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
	PORT: z.preprocess((val) => Number(val) || 3000, z.number().min(1)),
	DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
	REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
	REDIS_INITIAL_CONNECT_RETRIES: z.preprocess((val) => Number(val) || 5, z.number().min(1)),
	REDIS_INITIAL_CONNECT_BASE_DELAY: z.preprocess((val) => Number(val) || 200, z.number().min(1)),
	REFRESH_TOKEN_REDIS_PREFIX: z.string().default('refresh_token'),
	REVOKED_ACCESS_TOKEN_REDIS_PREFIX: z.string().default('revoked_access_token'),
	REVOKED_REFRESH_TOKEN_REDIS_PREFIX: z.string().default('revoked_refresh_token'),
	REFRESH_TOKEN_EXPIRY_SECONDS: z.preprocess((val) => Number(val) || 604800, z.number().min(1)), // 7 days
	RABBITMQ_URL: z.string().min(1, 'RABBITMQ_URL is required'),
	RABBITMQ_DEFAULT_USER: z.string().default('guest'),
	RABBITMQ_DEFAULT_PASS: z.string().default('guest'),
	RABBITMQ_MANAGEMENT_URL: z.string().min(1, 'RABBITMQ_MANAGEMENT_URL is required'),
	JWT_ACCESS_SECRET: z.string().min(1, 'JWT_ACCESS_SECRET is required'),
	JWT_REFRESH_SECRET: z.string().min(1, 'JWT_REFRESH_SECRET is required'),
	JWT_EXPIRES_IN: z.string().default('7d'),
	REFRESH_EXPIRATION_DAYS: z.preprocess((val) => Number(val) || 30, z.number().min(1)),
	JWT_ISSUER: z.string().default('insightfi'),
	JWT_AUDIENCE: z.string().default('insightfi'),
	SALT_ROUNDS: z.preprocess((val) => Number(val) || 10, z.number().min(1)),
	SMTP_HOST: z.string().default('smtp.gmail.com'),
	SMTP_SECURE: z.string().default('true'),
	SMTP_SECURE_PORT: z.preprocess((val) => Number(val) || 465, z.number().min(1)),
	SMTP_PORT: z.preprocess((val) => Number(val) || 465, z.number().min(1)),
	SMTP_USER: z.string().min(1, 'SMTP_USER is required'),
	SMTP_PASS: z.string().min(1, 'SMTP_PASS is required'),
	EMAIL_FROM: z.string().default('Insight'),
	FRONTEND_URL: z
		.string()
		.url('FRONTEND_URL must be a valid URL')
		.default('http://localhost:3001'),
	JWT_VERIFICATION_SECRET: z.string().min(1, 'JWT_VERIFICATION_SECRET is required'),
	JWT_VERIFICATION_EXPIRY: z.string().default('5m'),
	INVITE_SECRET: z.string().min(1, 'INVITE_SECRET is required'),
	DB_TOKEN_EXPIRY_HOURS: z.preprocess((val) => Number(val) || 24, z.number().min(1)),
	INVITE_JWT_EXPIRY: z.string().default('2h'),
	// --- AI Configuration ---
	OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY is required for AI features'),
	TOGETHER_API_KEY: z.string().min(1, 'TOGETHER_API_KEY is required for AI features'),
	OPENAI_TEMPERATURE: z.preprocess((val) => Number(val) || 0.2, z.number().min(0).max(1)),
	OPENAI_MODEL: z.string().default('gpt-3.5-turbo-instruct'),
	OPENAI_API_URL: z.string().default('https://api.openai.com/v1/chat/completions'),
	OPENAI_API_TIMEOUT: z.preprocess((val) => Number(val) || 15000, z.number().min(1)),
	OPENAI_API_RETRIES: z.preprocess((val) => Number(val) || 2, z.number().min(1)),
});

const env = envSchema.parse(process.env);

export default env;
