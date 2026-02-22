import Stripe from 'stripe';
import { env } from './env';

const stripeConfig = {
    apiVersion: '2025-01-27.acacia' as any,
    typescript: true,
} as const;

export const stripeTest = new Stripe(env.STRIPE_TEST_SECRET_KEY || env.STRIPE_SECRET_KEY, stripeConfig);
export const stripeLive = new Stripe(env.STRIPE_LIVE_SECRET_KEY || env.STRIPE_SECRET_KEY, stripeConfig);

/**
 * Helper to get the correct Stripe instance based on the mode.
 * Defaults to stripeTest if mode is invalid or not provided.
 */
export const getStripe = (mode?: 'test' | 'live') => {
    if (mode === 'live') return stripeLive;
    return stripeTest;
};

// Default export for backward compatibility
export const stripe = getStripe(env.STRIPE_MODE as any);
