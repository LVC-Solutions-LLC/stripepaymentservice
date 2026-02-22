import dotenv from 'dotenv';
import { z } from 'zod';

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

    // Fallback/Default Keys
    STRIPE_PUBLISHABLE_KEY: z.string().min(1),
    STRIPE_SECRET_KEY: z.string().min(1),
    STRIPE_WEBHOOK_SECRET: z.string().min(1),

    // URL for redirects
    FRONTEND_URL: z.string().url().default('http://localhost:3000'),

    // Placeholder for JWT secret if we implement auth
    JWT_SECRET: z.string().optional(),
});

const parseEnv = () => {
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
        console.error('❌ Invalid environment variables:', JSON.stringify(parsed.error.format(), null, 2));
        process.exit(1);
    }
    return parsed.data;
};

export const env = parseEnv();
