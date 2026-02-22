import { Router } from 'express';
import { getOneTimePricing, getSubscriptionPricing, getAllPricingMetadata, getPricingSchema } from '../controllers/pricing.controller';
import { validate } from '../middlewares/validate';

const router = Router();

router.get('/one-time', validate(getPricingSchema), getOneTimePricing);
router.get('/subscription/plan', validate(getPricingSchema), getSubscriptionPricing);
router.get('/all', getAllPricingMetadata);

export default router;
