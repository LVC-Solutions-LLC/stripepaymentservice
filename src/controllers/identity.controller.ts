import { Request, Response, NextFunction } from 'express';
import { IdentityService } from '../services/identity.service';
import { z } from 'zod';

const identityService = new IdentityService();

export const createIdentitySessionSchema = z.object({
    body: z.object({
        userId: z.string().min(1),
        email: z.string().email(),
        role: z.enum(['job_seeker', 'student_job_seeker', 'recruiter']),
        stripeMode: z.enum(['test', 'live']).optional(),
    }),
});

export const createIdentitySession = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { userId, email, role, stripeMode } = req.body;
        const result = await identityService.createVerificationSession(userId, email, role, stripeMode);

        res.status(200).json(result);
    } catch (err) {
        next(err);
    }
};

export const getIdentitySession = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { sessionId } = req.params;
        const { stripeMode } = req.query as { stripeMode?: 'test' | 'live' };
        const session = await identityService.getVerificationSession(sessionId as string, stripeMode);

        res.status(200).json(session);
    } catch (err) {
        next(err);
    }
};
