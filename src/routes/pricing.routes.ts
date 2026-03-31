import { Router } from 'express';
import { getOneTimePricing, getSubscriptionPricing, getAllPricingMetadata, getPricingSchema } from '../controllers/pricing.controller';
import { syncPricing, syncPricingSchema } from '../controllers/admin.pricing.controller';
import { validate } from '../middlewares/validate';

const router = Router();

router.get('/one-time', validate(getPricingSchema), getOneTimePricing);
router.get('/subscription/plan', validate(getPricingSchema), getSubscriptionPricing);
router.get('/all', getAllPricingMetadata);

// Admin Sync
router.post('/sync', validate(syncPricingSchema), syncPricing);

export default router;
