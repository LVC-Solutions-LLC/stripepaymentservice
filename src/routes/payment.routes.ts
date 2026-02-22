import { Router, Request, Response } from 'express';
import { env } from '../config/env';
import {
    createVerificationCheckoutSession,
    createVerificationCheckoutSchema,
    verifySession
} from '../controllers/payment.controller';
import { validate } from '../middlewares/validate';

const router = Router();

router.post(
    '/one-time/checkout-session',
    validate(createVerificationCheckoutSchema),
    createVerificationCheckoutSession
);

router.post('/verify-session', verifySession);

router.get('/config', (req: Request, res: Response) => {
    const publishableKey = env.STRIPE_MODE === 'live'
        ? (env.STRIPE_LIVE_PUBLISHABLE_KEY || env.STRIPE_PUBLISHABLE_KEY)
        : (env.STRIPE_TEST_PUBLISHABLE_KEY || env.STRIPE_PUBLISHABLE_KEY);

    res.status(200).json({
        status: 'success',
        data: {
            publishableKey: publishableKey,
            mode: env.STRIPE_MODE
        },
    });
});

export default router;
