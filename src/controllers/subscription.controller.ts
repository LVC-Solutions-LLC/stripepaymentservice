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
        const { userId, role, country, stripeMode, promoCode } = req.body;
        const result = await subscriptionService.changeSubscription(userId, id, role, country, stripeMode, promoCode);
        res.status(200).json({ status: "success", data: result });
    } catch (err) {
        next(err);
    }
};

export const applyCoupon = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params as { id: string }; // Subscription ID
        const { userId, promoCode, stripeMode } = req.body;
        const result = await subscriptionService.applyCouponToSubscription(userId, id, promoCode, stripeMode);
        res.status(200).json({ status: "success", data: result });
    } catch (err) {
        next(err);
    }
};

export const getInvoicesSchema = z.object({
    params: z.object({
        identifier: z.string().optional(),
    }).optional(),
    query: z.object({
        identifier: z.string().optional(),
        userId: z.string().optional(),
        email: z.string().optional(),
        stripeMode: z.enum(['test', 'live']).optional(),
        limit: z.string().optional(),
    }).optional(),
});

export const getUserInvoices = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const identifier = (
            (req.params.identifier as string) ||
            (req.query.identifier as string) ||
            (req.query.userId as string) ||
            (req.query.email as string)
        );

        if (!identifier) {
            return res.status(400).json({
                status: 'fail',
                message: 'User login identifier (userId, email, or customerId) is required as path param or query param',
            });
        }

        const stripeMode = req.query.stripeMode as 'test' | 'live' | undefined;
        const limit = req.query.limit ? Number(req.query.limit) : 50;

        const invoices = await subscriptionService.getUserInvoices(identifier, stripeMode, limit);

        res.status(200).json({
            status: 'success',
            count: invoices.length,
            data: invoices,
        });
    } catch (err) {
        next(err);
    }
};

