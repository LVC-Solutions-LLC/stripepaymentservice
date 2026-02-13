import { Request, Response, NextFunction } from 'express';
import { PaymentService } from '../services/payment.service';
import { z } from 'zod';

const paymentService = new PaymentService();

export const createVerificationIntentSchema = z.object({
    body: z.object({
        userId: z.string().uuid().or(z.string().min(1)), // Accept UUID or string ID
        email: z.string().email(),
        role: z.enum(['JOB_SEEKER', 'COMPANY', 'TEST', 'STUDENT', 'RECRUITER']),
        country: z.string().length(2), // ISO 2-letter country code
    }),
});

export const createVerificationCheckoutSchema = z.object({
    body: z.object({
        userId: z.string().uuid().or(z.string().min(1)),
        email: z.string().email(),
        role: z.enum(['JOB_SEEKER', 'COMPANY', 'TEST', 'STUDENT', 'RECRUITER']),
        country: z.string().length(2),
        successUrl: z.string().url(),
        cancelUrl: z.string().url(),
    }),
});

export const createVerificationCheckoutSession = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { userId, email, role, country, successUrl, cancelUrl } = req.body;
        const result = await paymentService.createVerificationCheckoutSession(
            userId, email, role, country, successUrl, cancelUrl
        );

        res.status(200).json({
            status: 'success',
            data: result,
        });
    } catch (err) {
        next(err);
    }
};

export const verifySession = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { userId, sessionId } = req.body;
        const result = await paymentService.verifySession(userId, sessionId);

        res.status(200).json(result);
    } catch (err) {
        next(err);
    }
};
