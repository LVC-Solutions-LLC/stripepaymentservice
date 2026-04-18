import { Router } from 'express';
import { getOneTimePricing, getSubscriptionPricing, getAllPricingMetadata, getPricingSchema } from '../controllers/pricing.controller';
import { syncPricing, syncPricingSchema, syncFullPricing } from '../controllers/admin.pricing.controller';
import { createCoupon, listCoupons, deactivateCoupon, createCouponSchema } from '../controllers/coupon.controller';
import { validate } from '../middlewares/validate';

const router = Router();

router.get('/one-time', validate(getPricingSchema), getOneTimePricing);
router.get('/subscription/plan', validate(getPricingSchema), getSubscriptionPricing);
router.get('/all', getAllPricingMetadata);

// Admin Sync
router.post('/sync', validate(syncPricingSchema), syncPricing);
router.post('/sync-full', syncFullPricing);

// Coupon Management
router.post('/coupons', validate(createCouponSchema), createCoupon);
router.get('/coupons', listCoupons);
router.patch('/coupons/:id/deactivate', deactivateCoupon);

export default router;
