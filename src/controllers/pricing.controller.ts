import { Request, Response, NextFunction } from 'express';
import defaultPricing from '../config/defaultPricing.json';
import { z } from 'zod';
import { db } from '../config/db';
import { getStripe } from '../config/stripe';

export const getPricingSchema = z.object({
    query: z.object({
        role: z.string(),
        country: z.string().length(2),
    }),
});

export const getOneTimePricing = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { role, country } = req.query as { role: string; country: string };
        const pricingDoc = await db.collection('configurations').doc('pricing').get();
        const pricingConfig = pricingDoc.exists ? pricingDoc.data() : defaultPricing;
        
        const regionKey = country === 'IN' ? 'india' : 'global';
        const priceField = country === 'IN' ? 'price_inr' : 'price_usd';
        const currency = country === 'IN' ? 'inr' : 'usd';

        const roleData = (pricingConfig as any)?.verificationFees?.[role]?.[regionKey]
                      || (pricingConfig as any)?.oneTime?.[role]?.[regionKey];
        
        let amount = Number(roleData?.[priceField]);
        if (!amount || isNaN(amount) || amount <= 0) {
            const rawMax = Number(roleData?.max);
            if (!isNaN(rawMax) && rawMax > 0) {
                amount = rawMax < 1000 ? rawMax * 100 : rawMax;
            }
        }

        if (!amount || isNaN(amount) || amount <= 0) {
            amount = country === 'IN' ? 49900 : 2000;
        }

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
        const pricingDoc = await db.collection('configurations').doc('pricing').get();
        const pricingConfig = pricingDoc.exists ? pricingDoc.data() : defaultPricing;

        res.status(200).json({
            status: 'success',
            data: {
                role,
                country,
                subscriptions: pricingConfig?.subscriptions?.[role] || {}
            },
        });
    } catch (err) {
        next(err);
    }
};

export const getAllPricingMetadata = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const pricingDoc = await db.collection('configurations').doc('pricing').get();
        
        res.status(200).json({
            status: 'success',
            data: pricingDoc.exists ? pricingDoc.data() : defaultPricing
        });
    } catch (err) {
        next(err);
    }
};

export const getPriceDetails = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { priceId, stripeMode } = req.query;
        if (!priceId || typeof priceId !== 'string') {
            return res.status(400).json({ status: 'error', message: 'priceId query parameter is required' });
        }

        const stripe = getStripe(stripeMode as any || 'test');
        const price = await stripe.prices.retrieve(priceId);

        const currency = price.currency.toUpperCase();
        const symbol = currency === 'INR' ? '₹' : '$';
        const unitAmount = price.unit_amount || 0;
        const majorAmount = unitAmount / 100;
        const productId = typeof price.product === 'string' ? price.product : (price.product as any)?.id || '';

        res.status(200).json({
            status: 'success',
            data: {
                id: price.id,
                productId,
                unitAmountPaise: unitAmount,
                amount: majorAmount,
                currency,
                symbol,
                active: price.active,
            }
        });
    } catch (err: any) {
        res.status(400).json({
            status: 'error',
            message: err.message || 'Failed to retrieve price from Stripe'
        });
    }
};
