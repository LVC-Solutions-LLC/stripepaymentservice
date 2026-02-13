import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { AppError } from '../utils/AppError';

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
            // ZodError has .issues
            const errorMessages = error.issues.map((issue: any) => ({
                message: `${issue.path.join('.')} is ${issue.message}`,
            }));

            // Log and return
            console.error('Validation Errors:', errorMessages);
            res.status(400).json({
                status: 'fail',
                message: 'Validation Error',
                errors: errorMessages
            });
            return;
        } else {
            next(new AppError('Internal Server Error', 500));
        }
    }
};
