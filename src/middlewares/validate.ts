import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { logger } from '../utils/logger';

export const validate = (schema: ZodSchema) => (req: Request, res: Response, next: NextFunction) => {
    try {
        schema.parse({
            body: req.body,
            query: req.query,
            params: req.params,
        });
        next();
    } catch (error) {
        if (error instanceof ZodError) {
            const errorMessages = error.issues.map((issue) => ({
                field: issue.path.join('.'),
                message: `${issue.path.join('.')} is ${issue.message}`,
            }));

            logger.warn('Validation Error:', errorMessages);
            res.status(400).json({
                status: 'fail',
                message: 'Validation Error',
                errors: errorMessages,
            });
            return;
        }
        next(error);
    }
};
