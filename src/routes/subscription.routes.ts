import { Router } from 'express';
import { createSubscription, cancelSubscription, updateSubscription, createSubscriptionSchema } from '../controllers/subscription.controller';
import { validate } from '../middlewares/validate';

const router = Router();

router.post('/', validate(createSubscriptionSchema), createSubscription);
router.delete('/:id', cancelSubscription); // Add validation if needed
router.patch('/:id', updateSubscription);

export default router;
