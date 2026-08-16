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

export const updateTrialDaysSchema = z.object({
    body: z.object({
        role: z.string().min(1),
        tier: z.string().min(1),
        // 0 = no trial, 1–730 = trial days
        trialDays: z.number().int().min(0).max(730),
    }),
});

export const syncPricing = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const result = await adminPricingService.syncStripeProduct(req.body, req.body.stripeMode);
        res.status(200).json({
            status: 'success',
            data: result,
        });
    } catch (err) {
        next(err);
    }
};

export const syncFullPricing = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const result = await adminPricingService.syncFullPricingConfig(req.body, req.body.stripeMode);
        res.status(200).json({
            status: 'success',
            data: result,
        });
    } catch (err) {
        next(err);
    }
};

export const updateTrialDays = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { role, tier, trialDays } = req.body;
        const result = await adminPricingService.updateTrialDays(role, tier, trialDays);
        res.status(200).json({
            status: 'success',
            data: result,
        });
    } catch (err) {
        next(err);
    }
};
