import { Router } from 'express';
import {
    createSubscription,
    cancelSubscription,
    updateSubscription,
    applyCoupon,
    createSubscriptionSchema,
    getUserInvoices,
    getInvoicesSchema,
    createCustomerPortal,
    customerPortalSchema,
    retrySubscriptionPayment,
    retryPaymentSchema,
    getUpdatePaymentCheckout,
    updatePaymentCheckoutSchema,
} from '../controllers/subscription.controller';
import { validate } from '../middlewares/validate';

const router = Router();

router.get('/invoices', validate(getInvoicesSchema), getUserInvoices);
router.get('/invoices/:identifier', validate(getInvoicesSchema), getUserInvoices);
router.post('/customer-portal', validate(customerPortalSchema), createCustomerPortal);
router.post('/retry-payment', validate(retryPaymentSchema), retrySubscriptionPayment);
router.post('/update-payment-checkout', validate(updatePaymentCheckoutSchema), getUpdatePaymentCheckout);
router.post('/', validate(createSubscriptionSchema), createSubscription);
router.post('/checkout-session', validate(createSubscriptionSchema), createSubscription);
router.delete('/:id', cancelSubscription);
router.patch('/:id', updateSubscription);
router.post('/:id/apply-coupon', applyCoupon);

export default router;



