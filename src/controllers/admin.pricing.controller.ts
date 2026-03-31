import { Request, Response, NextFunction } from 'express';
import { AdminPricingService } from '../services/admin.pricing.service';
import { z } from 'zod';

const adminPricingService = new AdminPricingService();

export const syncPricingSchema = z.object({
    body: z.object({
        type: z.enum(['ONE_TIME', 'SUBSCRIPTION']),
        role: z.string(),
        tier: z.string().optional(),
        stripeProductId: z.string().optional().nullable(),
        stripePriceId_inr: z.string().optional().nullable(),
        stripePriceId_usd: z.string().optional().nullable(),
        indiaPricePaise: z.number(),
        globalPriceCents: z.number(),
        name: z.string(),
        description: z.string().optional(),
        stripeMode: z.enum(['test', 'live']).optional(),
    }),
});

export const syncPricing = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const result = await adminPricingService.syncStripeProduct(req.body, req.body.stripeMode);
        res.status(200).json({
            status: 'success',
            data: result
        });
    } catch (err: any) {
        console.error("syncPricing Error:", err);
        // We'll also return a 400 with the error message so Next.js sees it in the catch block rather than just 'error'
        res.status(400).json({
            status: 'error',
            message: err.message
        });
    }
};
