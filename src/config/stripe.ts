import Stripe from 'stripe';
import { env } from './env';

const stripeConfig: Stripe.StripeConfig = {
    typescript: true,
};

export const stripeTest = new Stripe(env.STRIPE_TEST_SECRET_KEY || 'sk_test_placeholder', stripeConfig);
export const stripeLive = new Stripe(env.STRIPE_LIVE_SECRET_KEY || 'sk_live_placeholder', stripeConfig);

/**
 * Helper to get the correct Stripe instance based on the mode.
 * Defaults to stripeTest if mode is invalid or not provided.
 */
export const getStripe = (mode?: 'test' | 'live'): Stripe => {
    const effectiveMode = mode || env.STRIPE_MODE;
    if (effectiveMode === 'live') return stripeLive;
    return stripeTest;
};

// Default export for backward compatibility
export const stripe = getStripe(env.STRIPE_MODE);
