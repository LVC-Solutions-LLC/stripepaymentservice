import dotenv from 'dotenv';
import { z } from 'zod';
import { logger } from '../utils/logger';

dotenv.config();

const envSchema = z.object({
    PORT: z.string().default('3000'),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    FIREBASE_PROJECT_ID: z.string().min(1),
    FIREBASE_CLIENT_EMAIL: z.string().email(),
    FIREBASE_PRIVATE_KEY: z.string().min(1),

    // Stripe Configuration
    STRIPE_MODE: z.enum(['test', 'live']).default('test'),

    // Test Keys
    STRIPE_TEST_PUBLISHABLE_KEY: z.string().optional(),
    STRIPE_TEST_SECRET_KEY: z.string().optional(),
    STRIPE_TEST_WEBHOOK_SECRET: z.string().optional(),

    // Live Keys
    STRIPE_LIVE_PUBLISHABLE_KEY: z.string().optional(),
    STRIPE_LIVE_SECRET_KEY: z.string().optional(),
    STRIPE_LIVE_WEBHOOK_SECRET: z.string().optional(),

    // URL for redirects
    FRONTEND_URL: z.string().url().default('http://localhost:3000'),

    // Placeholder for JWT secret if we implement auth
    JWT_SECRET: z.string().optional(),
});

const parseEnv = () => {
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
        logger.error('❌ Invalid environment variables:', parsed.error.format());
        process.exit(1);
    }
    return parsed.data;
};

export const env = parseEnv();

logger.info(`🚀 [Payment Service] Configured for Project: ${env.FIREBASE_PROJECT_ID} on Port: ${env.PORT}`);
