import { Request, Response, NextFunction } from 'express';
import { IdentityService } from '../services/identity.service';
import { z } from 'zod';

const identityService = new IdentityService();

export const createIdentitySessionSchema = z.object({
    body: z.object({
        userId: z.string().min(1),
        email: z.string().email(),
        role: z.enum(['job_seeker', 'student_job_seeker', 'recruiter', 'jobseeker', 'studentjobseeker', 'company', 'admin', 'user', 'super_admin', 'university']),
        returnUrl: z.string().url(),
        stripeMode: z.enum(['test', 'live']).optional(),
    }),
});

export const createIdentitySession = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { userId, email, role, returnUrl, stripeMode } = req.body;
        const result = await identityService.createVerificationSession(userId, email, role, returnUrl, stripeMode);

        res.status(200).json(result);
    } catch (err) {
        next(err);
    }
};

export const getIdentitySession = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { sessionId } = req.params;
        const { stripeMode, userId } = req.query as { stripeMode?: 'test' | 'live', userId?: string };

        // SECURITY/STABILITY: Ignore literal Stripe placeholders
        if (sessionId.includes('{VERIFICATION_SESSION_ID}') || sessionId.includes('%7BVERIFICATION_SESSION_ID%7D')) {
            console.log(`[POLL_REJECTED] Literal placeholder detected: ${sessionId}. Triggering fallback...`);
            return res.status(404).json({ error: 'Placeholder session ID detected. Please use the /latest endpoint or check back in a minute.' });
        }

        console.log(`[POLL_REQUEST] Session: ${sessionId}, UserID: ${userId}, Mode: ${stripeMode || 'default'}`);

        const session = await identityService.getVerificationSession(sessionId as string, stripeMode, userId);

        res.status(200).json(session);
    } catch (err) {
        next(err);
    }
};

export const getLatestIdentitySession = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { userId, stripeMode } = req.query as { userId: string, stripeMode?: 'test' | 'live' };

        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }

        console.log(`[LATEST_REQUEST] UserID: ${userId}, Mode: ${stripeMode || 'default'}`);

        const session = await identityService.getLatestVerificationSession(userId, stripeMode);

        if (!session) {
            return res.status(404).json({ error: 'No verification session found for this user' });
        }

        res.status(200).json(session);
    } catch (err) {
        next(err);
    }
};
