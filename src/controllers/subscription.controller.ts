import { Request, Response, NextFunction } from 'express';
import { SubscriptionService } from '../services/subscription.service';
import { z } from 'zod';

const subscriptionService = new SubscriptionService();

export const createSubscriptionSchema = z.object({
    body: z.object({
        userId: z.string().uuid().or(z.string().min(1)),
        email: z.string().email(),
        role: z.string(),
        country: z.string().length(2),
        planId: z.string().optional(),
        stripeMode: z.enum(['test', 'live']).optional(),
    }),
});

export const createSubscription = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { userId, email, role, country, planId, stripeMode } = req.body;
        const result = await subscriptionService.createSubscription(userId, email, role, country, planId, stripeMode);
        res.status(201).json({ status: "success", data: result });
    } catch (err) {
        next(err);
    }
};

export const cancelSubscription = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params as { id: string }; // Subscription ID
        const { userId, stripeMode } = req.body; // In real app, from req.user

        const result = await subscriptionService.cancelSubscription(userId, id, stripeMode);
        res.status(200).json(result);
    } catch (err) {
        next(err);
    }
};

export const updateSubscription = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params as { id: string };
        const { userId, role, country, stripeMode } = req.body;
        const result = await subscriptionService.changeSubscription(userId, id, role, country, stripeMode);
        res.status(200).json(result);
    } catch (err) {
        next(err);
    }
}
