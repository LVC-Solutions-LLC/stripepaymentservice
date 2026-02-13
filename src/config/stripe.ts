import Stripe from 'stripe';
import { env } from './env';

const getStripeSecretKey = () => {
    if (env.STRIPE_MODE === 'live') {
        return env.STRIPE_LIVE_SECRET_KEY || env.STRIPE_SECRET_KEY;
    }
    return env.STRIPE_TEST_SECRET_KEY || env.STRIPE_SECRET_KEY;
};

export const stripe = new Stripe(getStripeSecretKey(), {
    apiVersion: '2025-01-27.acacia' as any,
    typescript: true,
});
