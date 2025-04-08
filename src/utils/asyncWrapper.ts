import { RequestHandler, Request, Response, NextFunction } from 'express';
import { AuthRequest } from '@/middleware/authMiddleware';

type AuthenticatedRequestHandler = (
    req: AuthRequest, // Expects AuthRequest specifically
    res: Response,
    next: NextFunction
) => Promise<any> | any; 

/**
 * Wraps an asynchronous request handler specifically designed for authenticated routes,
 * ensuring the AuthRequest type is maintained and catching errors.
 */
export function asyncWrapper(
    handler: AuthenticatedRequestHandler // Accepts handlers expecting AuthRequest
): RequestHandler { 
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            await handler(req as AuthRequest, res, next);
        } catch (error) {
            next(error); 
        }
    };
}