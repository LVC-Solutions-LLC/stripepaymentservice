import { Request, Response, NextFunction } from 'express';
import { PaymentService } from '../services/payment.service';
import { z } from 'zod';

const paymentService = new PaymentService();

export const createVerificationIntentSchema = z.object({
    body: z.object({
        userId: z.string().uuid().or(z.string().min(1)), // Accept UUID or string ID
        email: z.string().email(),
        role: z.enum(['job_seeker', 'company', 'test', 'student_job_seeker', 'recruiter']),
        country: z.string().length(2), // ISO 2-letter country code
        stripeMode: z.enum(['test', 'live']).optional(),
    }),
});

export const createVerificationCheckoutSchema = z.object({
    body: z.object({
        userId: z.string().uuid().or(z.string().min(1)),
        email: z.string().email(),
        role: z.enum(['job_seeker', 'company', 'test', 'student_job_seeker', 'recruiter']),
        country: z.string().length(2),
        stripeMode: z.enum(['test', 'live']).optional(),
        successUrl: z.string().url(),
        cancelUrl: z.string().url(),
    }),
});

export const createVerificationCheckoutSession = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { userId, email, role, country, successUrl, cancelUrl, stripeMode } = req.body;
        const result = await paymentService.createVerificationCheckoutSession(
            userId, email, role, country, successUrl, cancelUrl, stripeMode
        );

        res.status(200).json(result);
    } catch (err) {
        next(err);
    }
};

export const verifySession = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { userId, sessionId, stripeMode } = req.body;
        const result = await paymentService.verifySession(userId, sessionId, stripeMode);

        res.status(200).json(result);
    } catch (err) {
        next(err);
    }
};
