import { Request, Response, NextFunction } from 'express';
import { CouponService } from '../services/coupon.service';
import { z } from 'zod';

const couponService = new CouponService();

// ─── Validation Schemas ───────────────────────────────────────────────────────

export const createCouponSchema = z.object({
    body: z.object({
        name: z.string().min(1, 'Coupon name is required'),
        promoCode: z
            .string()
            .min(3, 'Promo code must be at least 3 characters')
            .max(20, 'Promo code must be at most 20 characters')
            .regex(/^[A-Z0-9_-]+$/i, 'Promo code must be alphanumeric (dashes and underscores allowed)'),
        type: z.enum(['percent', 'fixed']),
        value: z.number().positive('Value must be positive'),
        currency: z.enum(['inr', 'usd']).optional(),
        duration: z.enum(['once', 'forever', 'repeating']),
        durationMonths: z.number().int().positive().optional(),
        maxRedemptions: z.number().int().positive().optional(),
        expiresAt: z.string().datetime({ offset: true }).optional(),
        productKeys: z.array(z.string()).nullish().transform(val => val ?? []),
        stripeMode: z.enum(['test', 'live']).optional().default('test'),
    }),
});

export const deactivateCouponSchema = z.object({
    params: z.object({
        id: z.string().min(1, 'Coupon ID is required'),
    }),
    query: z.object({
        stripeMode: z.enum(['test', 'live']).optional().default('test'),
    }),
});

export const listCouponsSchema = z.object({
    query: z.object({
        stripeMode: z.enum(['test', 'live']).optional().default('test'),
    }),
});

// ─── Controllers ──────────────────────────────────────────────────────────────

/**
 * POST /pricing/coupons
 * Create a new Stripe coupon + promotion code, synced to Firestore.
 */
export const createCoupon = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { stripeMode = 'test', ...rest } = req.body;
        const productKeys = req.body.productKeys || [];
        delete rest.productKeys;

        // Resolve friendly product keys to Stripe Product IDs if provided
        let stripeProductIds: string[] = [];
        if (productKeys.length > 0) {
            stripeProductIds = await couponService.resolveStripeProductIds(productKeys);

            if (stripeProductIds.length === 0) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Could not resolve Stripe Product IDs for the selected products. Ensure the pricing config has been synced first.',
                });
            }
        }

        const record = await couponService.createCoupon({
            ...rest,
            productKeys,
            stripeProductIds,
            stripeMode,
        });

        return res.status(201).json({
            status: 'success',
            data: record,
        });
    } catch (err: any) {
        console.error('[CouponController] createCoupon error:', err);
        return res.status(err.statusCode || 400).json({
            status: 'error',
            message: err.message,
        });
    }
};

/**
 * GET /pricing/coupons
 * List all coupons from Firestore, enriched with live Stripe status.
 */
export const listCoupons = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const stripeMode = (req.query.stripeMode as 'test' | 'live') ?? 'test';
        const coupons = await couponService.listCoupons(stripeMode);

        return res.status(200).json({
            status: 'success',
            data: coupons,
        });
    } catch (err: any) {
        console.error('[CouponController] listCoupons error:', err);
        return res.status(err.statusCode || 500).json({
            status: 'error',
            message: err.message,
        });
    }
};

/**
 * PATCH /pricing/coupons/:id/deactivate
 * Deactivate a coupon: archives in Stripe + marks inactive in Firestore.
 */
export const deactivateCoupon = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const stripeMode = (req.query.stripeMode as 'test' | 'live') ?? 'test';

        await couponService.deactivateCoupon(id as string, stripeMode);

        return res.status(200).json({
            status: 'success',
            message: `Coupon ${id} has been deactivated and will no longer be redeemable.`,
        });
    } catch (err: any) {
        console.error('[CouponController] deactivateCoupon error:', err);
        return res.status(err.statusCode || 500).json({
            status: 'error',
            message: err.message,
        });
    }
};
