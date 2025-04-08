import express from 'express';
import {
	registerHandler,
	loginHandler,
	verifyEmailHandler,
	resendVerificationHandler,
	registerCompanyHandler
} from './auth.controller';
import { validate } from '../../middleware/validate';
import { RegisterSchema, LoginSchema, ResendVerificationSchema, RegisterCompanySchema } from './validate';

const authRouter = express.Router();

authRouter.post('/register', validate(RegisterSchema), registerHandler);
authRouter.post('/login', validate(LoginSchema), loginHandler);
authRouter.get('/verify-email', verifyEmailHandler);
authRouter.post('/register-company', validate(RegisterCompanySchema), registerCompanyHandler);

authRouter.post(
	'/resend-verification',
	validate(ResendVerificationSchema),
	resendVerificationHandler
);

export default authRouter;
