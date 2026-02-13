import { Router, raw } from 'express';
import { handleStripeWebhook } from '../controllers/webhook.controller';

const router = Router();

// Match the webhook endpoint
// Use raw body parser strictly for this route
router.post('/stripe', raw({ type: 'application/json' }), handleStripeWebhook);

export default router;
