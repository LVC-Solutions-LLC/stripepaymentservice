import { Router } from 'express';
import { createSubscription, cancelSubscription, updateSubscription, applyCoupon, createSubscriptionSchema } from '../controllers/subscription.controller';
import { validate } from '../middlewares/validate';

const router = Router();

router.post('/', validate(createSubscriptionSchema), createSubscription);
router.post('/checkout-session', validate(createSubscriptionSchema), createSubscription);
router.delete('/:id', cancelSubscription);
router.patch('/:id', updateSubscription);
router.post('/:id/apply-coupon', applyCoupon);

export default router;
