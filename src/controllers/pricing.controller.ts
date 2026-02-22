import { Request, Response, NextFunction } from 'express';
import { getOneTimeFee, getSubscriptionPlanId, ONE_TIME_FEES, SUBSCRIPTION_PLANS } from '../config/pricing';
import { z } from 'zod';

export const getPricingSchema = z.object({
    query: z.object({
        role: z.string(),
        country: z.string().length(2),
    }),
});

export const getOneTimePricing = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { role, country } = req.query as { role: string; country: string };
        const amount = getOneTimeFee(role, country);
        const currency = country === 'IN' ? 'inr' : 'usd';

        // Formatted amount (e.g. 199.00)
        const formattedAmount = (amount / 100).toFixed(2);

        res.status(200).json({
            status: 'success',
            data: {
                amount,
                currency,
                formattedAmount,
                currencySymbol: currency === 'inr' ? '₹' : '$',
            },
        });
    } catch (err) {
        next(err);
    }
};

export const getSubscriptionPricing = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { role, country } = req.query as { role: string; country: string };
        const planId = getSubscriptionPlanId(role, country);

        // In a more advanced version, we might fetch actual price details from Stripe here
        // For now, we return the planId and basic info
        res.status(200).json({
            status: 'success',
            data: {
                planId,
                role,
                country,
            },
        });
    } catch (err) {
        next(err);
    }
};

export const getAllPricingMetadata = async (req: Request, res: Response, next: NextFunction) => {
    try {
        res.status(200).json({
            status: 'success',
            data: {
                oneTimeFees: ONE_TIME_FEES,
                subscriptionPlans: SUBSCRIPTION_PLANS
            }
        });
    } catch (err) {
        next(err);
    }
}
