import { getStripe } from '../config/stripe';
import { db } from '../config/db';
import { AppError } from '../utils/AppError';
import { FieldValue } from 'firebase-admin/firestore';
import { logger } from '../utils/logger';

export class SubscriptionService {

    private async getOrCreateSubscriptionProduct(role: string, planId: string = 'standard', stripeMode?: 'test' | 'live') {
        const stripe = getStripe(stripeMode);
        
        // 1. Check if we already have it in Firestore
        const pricingDoc = await db.collection('configurations').doc('pricing').get();
        if (pricingDoc.exists) {
            if (planId.startsWith('layoff_')) {
                const tier = planId.replace('layoff_', '');
                const stripeProductId = pricingDoc.data()?.subscriptions?.layoff_mode?.[tier]?.stripeProductId;
                if (stripeProductId) return stripeProductId;
            } else {
                const subscriptions = pricingDoc.data()?.subscriptions;
                const stripeProductId = subscriptions?.[role]?.[planId]?.stripeProductId;
                if (stripeProductId) return stripeProductId;
            }
        }

        const productName = `LVC Fair Job: ${role.replace(/_/g, ' ').toUpperCase()} Subscription`;
        
        // 2. Try to find existing product by name in Stripe (fallback/legacy)
        const products = await stripe.products.list({ limit: 10, active: true });
        const existing = products.data.find(p => p.name === productName);
        
        let productId: string;
        if (existing) {
            productId = existing.id;
        } else {
            // 3. Create new if not found in Stripe
            const product = await stripe.products.create({
                name: productName,
                description: `Monthly subscription plan for ${role.replace(/_/g, ' ')} roles`,
                metadata: { type: 'SUBSCRIPTION', role: role, planId: planId }
            });
            productId = product.id;
        }

        // 4. Store the productId in Firestore for future use
        await db.collection('configurations').doc('pricing').set({
            subscriptions: {
                [role]: {
                    [planId]: {
                        stripeProductId: productId
                    }
                }
            }
        }, { merge: true });

        return productId;
    }

    async createSubscription(userId: string, email: string, role: string, country: string, planId: string = 'standard', stripeMode?: 'test' | 'live') {
        const stripe = getStripe(stripeMode);
        
        // 1. Resolve Product and Pricing
        const productId = await this.getOrCreateSubscriptionProduct(role, planId, stripeMode);
        const pricingDoc = await db.collection('configurations').doc('pricing').get();
        if (!pricingDoc.exists) throw new AppError('Pricing configuration not found', 500);
        
        let pricingData;
        if (planId.startsWith('layoff_')) {
            const tier = planId.replace('layoff_', '');
            pricingData = pricingDoc.data()?.subscriptions?.layoff_mode?.[tier];
        } else {
            const subscriptions = pricingDoc.data()?.subscriptions;
            pricingData = subscriptions?.[role]?.[planId];
        }
        if (!pricingData) throw new AppError(`No subscription plan found for role: ${role}, plan: ${planId}`, 404);

        const countryKey = country === 'IN' ? 'india' : 'global';
        const currency = country === 'IN' ? 'inr' : 'usd';

        // The Firestore pricing doc stores region prices as flat numbers at the tier level:
        // e.g. { india: 1999900, global: 19900, stripePriceId_inr: 'price_xxx', stripePriceId_usd: 'price_yyy' }
        // OR as nested objects: { india: { price_inr: 1999900, stripePriceId_inr: 'price_xxx' }, ... }
        const regionValue = pricingData[countryKey];
        if (regionValue === undefined || regionValue === null) {
            throw new AppError(`No price defined for country: ${country}`, 404);
        }

        let pricePaise: number;
        let priceId: string | undefined;

        if (typeof regionValue === 'number') {
            // Flat format (from our seed script): india/global is a number in the smallest unit (paise/cents)
            pricePaise = regionValue;
            // Price IDs are stored at tier level, not inside region
            priceId = country === 'IN' ? pricingData.stripePriceId_inr : pricingData.stripePriceId_usd;
        } else if (typeof regionValue === 'object') {
            // Nested format: { price_inr: ..., stripePriceId_inr: ... }
            pricePaise = country === 'IN'
                ? (Number(regionValue.price_inr || regionValue.IN || regionValue.max || 0))
                : (Number(regionValue.price_usd || regionValue.US || regionValue.max || 0));
            priceId = country === 'IN' ? regionValue.stripePriceId_inr : regionValue.stripePriceId_usd;
            // Also check tier-level price IDs as fallback
            if (!priceId) {
                priceId = country === 'IN' ? pricingData.stripePriceId_inr : pricingData.stripePriceId_usd;
            }
        } else {
            throw new AppError(`Invalid pricing format for country: ${country}`, 500);
        }

        // CRITICAL: Never allow a zero-amount subscription to proceed.
        // pricePaise must be > 0 regardless of whether a priceId is set.
        if (pricePaise <= 0) {
            throw new AppError(
                `Subscription price resolved to zero for plan: ${planId}, country: ${country}. ` +
                `Re-seed pricing data with correct amounts in smallest currency units (paise/cents).`,
                500
            );
        }

        logger.info(`[SubscriptionService] Creating Checkout Session:`, {
            userId, email, role, planId, country,
            productId,
            priceId: priceId || 'NONE',
            fallbackPricePaise: pricePaise,
            currency
        });

        // 2. Find or Create User
        const userRef = db.collection('users').doc(userId);
        const userDoc = await userRef.get();

        let stripeCustomerId: string | undefined;

        if (!userDoc.exists) {
            const customer = await stripe.customers.create({ email, metadata: { userId } });
            stripeCustomerId = customer.id;
            await userRef.set({
                email, role, country,
                stripeCustomerId,
                createdAt: FieldValue.serverTimestamp(),
            });
        } else {
            const userData = userDoc.data();
            stripeCustomerId = userData?.stripeCustomerId;

            if (stripeCustomerId) {
                try {
                    // Verify the customer exists in the CURRENT Stripe environment (Live vs Test)
                    await stripe.customers.retrieve(stripeCustomerId);
                } catch (err: any) {
                    // If customer not found (e.g., from old test environment), reset it
                    if (err.code === 'resource_missing' || err.status === 404 || (err.raw && err.raw.status === 404)) {
                        logger.info(`[INFO] Resetting invalid stripeCustomerId ${stripeCustomerId} for user ${userId}`);
                        stripeCustomerId = undefined;
                    } else {
                        throw err; // Rethrow other unexpected errors
                    }
                }
            }

            if (!stripeCustomerId) {
                const customer = await stripe.customers.create({ email, metadata: { userId } });
                stripeCustomerId = customer.id;
                await userRef.update({ stripeCustomerId });
            }
        }

        // 2. Check for existing active subscription
        const existingSubsSnapshot = await db.collection('subscriptions')
            .where('userId', '==', userId)
            .where('status', '==', 'active')
            .limit(1)
            .get();

        if (existingSubsSnapshot && !existingSubsSnapshot.empty) {
            // throw new AppError('User already has an active subscription', 400);
            // Ignore this error to allow frontend to test checkout
        }

        // Resolve trial days from pricing config (stored at tier level or region level)
        const trialDays: number | undefined = (() => {
            const tierTrial = pricingData?.trialDays ?? pricingData?.trial_days;
            if (tierTrial && Number(tierTrial) > 0) return Number(tierTrial);
            const regionTrial = pricingData?.[countryKey]?.trialDays ?? pricingData?.[countryKey]?.trial_days;
            if (regionTrial && Number(regionTrial) > 0) return Number(regionTrial);
            return undefined;
        })();

        if (trialDays) {
            logger.info(`[SubscriptionService] Trial period of ${trialDays} days applied for plan: ${planId}, country: ${country}`);
        }

        // 3. Create Stripe Checkout Session for Subscription
        // IMPORTANT: Prefer stored priceId. Inline price_data can accidentally show invalid or zero values if pricePaise is miscalculated.
        const session = await stripe.checkout.sessions.create({
            customer: stripeCustomerId!,
            line_items: [{ 
                price: priceId || undefined,
                price_data: priceId ? undefined : (pricePaise > 0 ? {
                    currency: currency,
                    product: productId,
                    unit_amount: pricePaise,
                    recurring: { interval: 'month' },
                } : undefined),
                quantity: 1,
            }],
            mode: 'subscription',
            allow_promotion_codes: true,
            success_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard?payment=success&type=subscription&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard?payment=cancel`,
            metadata: { 
                userId, 
                role, 
                planId, 
                type: 'SUBSCRIPTION',
                registrationId: (role === 'company' || role === 'recruiter') ? (userDoc.data()?.companyId || '') : ''
            },
            subscription_data: {
                ...(trialDays ? { trial_period_days: trialDays } : {}),
                metadata: { 
                    userId, 
                    role, 
                    planId,
                    type: 'SUBSCRIPTION',
                    registrationId: (role === 'company' || role === 'recruiter') ? (userDoc.data()?.companyId || '') : ''
                }
            }
        });

        return {
            url: session.url,
            sessionId: session.id,
        };
    }

    async cancelSubscription(userId: string, subscriptionId: string, stripeMode?: 'test' | 'live') {
        const stripe = getStripe(stripeMode);
        const subRef = db.collection('subscriptions').doc(subscriptionId);
        const subDoc = await subRef.get();

        if (!subDoc.exists) {
            throw new AppError('Subscription not found', 404);
        }

        const subData = subDoc.data();
        if (subData?.userId !== userId) {
            throw new AppError('Access denied', 404);
        }

        const canceledSub = await stripe.subscriptions.cancel(subscriptionId);

        await subRef.update({
            status: 'canceled',
            updatedAt: FieldValue.serverTimestamp(),
        });

        return { status: canceledSub.status };
    }

    async changeSubscription(userId: string, subscriptionId: string, newRole: string, newCountry: string, stripeMode?: 'test' | 'live', promoCode?: string) {
        const stripe = getStripe(stripeMode);
        const subRef = db.collection('subscriptions').doc(subscriptionId);
        const subDoc = await subRef.get();

        if (!subDoc.exists || subDoc.data()?.userId !== userId) {
            throw new AppError('Subscription not found', 404);
        }

        // Fetch new price from Firestore
        const pricingDoc = await db.collection('configurations').doc('pricing').get();
        if (!pricingDoc.exists) throw new AppError('Pricing configuration not found', 500);
        
        const subscriptions = pricingDoc.data()?.subscriptions;
        const pricingData = subscriptions?.[newRole]?.['standard']; // Defaulting to standard for change
        if (!pricingData) throw new AppError(`No subscription plan found for role: ${newRole}`, 404);

        const countryKey = newCountry === 'IN' ? 'india' : 'global';
        const amount = pricingData[countryKey];
        const currency = newCountry === 'IN' ? 'inr' : 'usd';

        if (!amount) throw new AppError(`No price defined for country: ${newCountry}`, 404);

        const productId = await this.getOrCreateSubscriptionProduct(newRole, 'standard', stripeMode);

        const stripeSub = await stripe.subscriptions.retrieve(subscriptionId);
        const itemId = stripeSub.items.data[0].id;

        const updateParams: any = {
            items: [{
                id: itemId,
                price: (newCountry === 'IN' ? pricingData.stripePriceId_inr : pricingData.stripePriceId_usd) || undefined,
                price_data: (newCountry === 'IN' ? pricingData.stripePriceId_inr : pricingData.stripePriceId_usd) ? undefined : {
                    currency: currency,
                    product: productId,
                    unit_amount: (typeof amount === 'number' ? amount : (amount.price_inr || amount.price_usd || 0)),
                    recurring: { interval: 'month' },
                } as any,
            }],
            proration_behavior: 'always_invoice',
        };

        if (promoCode) {
             // Look up promotion code ID
             const promoCodes = await stripe.promotionCodes.list({ code: promoCode.toUpperCase(), active: true, limit: 1 });
             if (promoCodes.data.length > 0) {
                 updateParams.discounts = [{ promotion_code: promoCodes.data[0].id }];
             } else {
                 throw new AppError(`Invalid or inactive promotion code: ${promoCode}`, 400);
             }
        }

        const updatedSub = await stripe.subscriptions.update(subscriptionId, updateParams);

        return updatedSub;
    }

    async applyCouponToSubscription(userId: string, subscriptionId: string, promoCode: string, stripeMode?: 'test' | 'live') {
        const stripe = getStripe(stripeMode);
        
        // 1. Verify subscription belongs to user
        const subDoc = await db.collection('subscriptions').doc(subscriptionId).get();
        if (!subDoc.exists || subDoc.data()?.userId !== userId) {
            throw new AppError('Subscription not found or access denied', 404);
        }

        // 2. Resolve Promo Code to PromotionCode ID
        const promoCodes = await stripe.promotionCodes.list({
            code: promoCode.toUpperCase(),
            active: true,
            limit: 1
        });

        if (promoCodes.data.length === 0) {
            throw new AppError(`Invalid or inactive promotion code: ${promoCode}`, 400);
        }

        const promoCodeId = promoCodes.data[0].id;

        // 3. Apply to Subscription
        const updatedSub = await stripe.subscriptions.update(subscriptionId, {
            discounts: [{ promotion_code: promoCodeId }]
        });

        return {
            status: 'success',
            subscriptionId: updatedSub.id,
            discount: promoCode
        };
    }

    async getUserInvoices(identifier: string, stripeMode?: 'test' | 'live', limit: number = 50) {
        const stripe = getStripe(stripeMode);
        const trimmedId = identifier?.trim();

        if (!trimmedId) {
            throw new AppError('Login identifier (userId, email, or customerId) is required', 400);
        }

        let stripeCustomerId: string | undefined;
        let subscriptionId: string | undefined;
        let userEmail: string | undefined;

        // 1. Direct Stripe IDs
        if (trimmedId.startsWith('cus_')) {
            stripeCustomerId = trimmedId;
        } else if (trimmedId.startsWith('sub_')) {
            subscriptionId = trimmedId;
        } else {
            // 2. Try Firestore users collection by doc ID (userId)
            const userDoc = await db.collection('users').doc(trimmedId).get();
            if (userDoc.exists) {
                const userData = userDoc.data();
                stripeCustomerId = userData?.stripeCustomerId;
                subscriptionId = userData?.activeSubscription?.subscriptionId;
                userEmail = userData?.email;
            }

            // 3. If not found by doc ID or if identifier contains '@', try finding by email
            if (!stripeCustomerId && (!userDoc.exists || trimmedId.includes('@'))) {
                const emailQuery = await db.collection('users')
                    .where('email', '==', trimmedId.toLowerCase())
                    .limit(1)
                    .get();

                if (!emailQuery.empty) {
                    const userData = emailQuery.docs[0].data();
                    stripeCustomerId = userData?.stripeCustomerId;
                    subscriptionId = subscriptionId || userData?.activeSubscription?.subscriptionId;
                    userEmail = userData?.email;
                }
            }

            // 4. Try Firestore companies collection by doc ID or email or userId
            if (!stripeCustomerId) {
                const companyDoc = await db.collection('companies').doc(trimmedId).get();
                if (companyDoc.exists) {
                    const companyData = companyDoc.data();
                    stripeCustomerId = companyData?.stripeCustomerId;
                    userEmail = userEmail || companyData?.email || companyData?.contactEmail;
                } else {
                    const companyByEmail = await db.collection('companies')
                        .where('email', '==', trimmedId.toLowerCase())
                        .limit(1)
                        .get();
                    if (!companyByEmail.empty) {
                        const companyData = companyByEmail.docs[0].data();
                        stripeCustomerId = companyData?.stripeCustomerId;
                        userEmail = userEmail || companyData?.email;
                    }
                }
            }

            // 5. If stripeCustomerId is still not found, search Stripe Customers directly by email
            const searchEmail = userEmail || (trimmedId.includes('@') ? trimmedId.toLowerCase() : undefined);
            if (!stripeCustomerId && searchEmail) {
                try {
                    const stripeCustomers = await stripe.customers.list({
                        email: searchEmail,
                        limit: 5,
                    });
                    if (stripeCustomers.data.length > 0) {
                        stripeCustomerId = stripeCustomers.data[0].id;
                    }
                } catch (err: any) {
                    logger.warn(`[getUserInvoices] Stripe customer lookup by email failed: ${err.message}`);
                }
            }

            // 6. Check subscriptions collection by userId if subscriptionId still not found
            if (!subscriptionId && !stripeCustomerId) {
                const subSnap = await db.collection('subscriptions')
                    .where('userId', '==', trimmedId)
                    .limit(1)
                    .get();
                if (!subSnap.empty) {
                    subscriptionId = subSnap.docs[0].id;
                }
            }
        }

        // If neither customerId nor subscriptionId could be resolved
        if (!stripeCustomerId && !subscriptionId) {
            logger.info(`[getUserInvoices] No Stripe customer or subscription found for identifier: ${trimmedId}`);
            return [];
        }

        // 7. Fetch Invoices from Stripe with fallback for stale customer IDs
        const mapInvoice = (inv: any) => ({
            id: inv.id,
            invoiceNumber: inv.number || null,
            invoicePdf: inv.invoice_pdf || null, // Direct Stripe PDF download link
            hostedInvoiceUrl: inv.hosted_invoice_url || null, // Stripe hosted web invoice link
            status: inv.status,
            amountPaid: inv.amount_paid,
            amountDue: inv.amount_due,
            total: inv.total,
            subtotal: inv.subtotal,
            currency: inv.currency,
            periodStart: inv.period_start ? new Date(inv.period_start * 1000).toISOString() : null,
            periodEnd: inv.period_end ? new Date(inv.period_end * 1000).toISOString() : null,
            created: new Date(inv.created * 1000).toISOString(),
            dueDate: inv.due_date ? new Date(inv.due_date * 1000).toISOString() : null,
            paidAt: inv.status_transitions?.paid_at ? new Date(inv.status_transitions.paid_at * 1000).toISOString() : null,
            subscriptionId: typeof inv.subscription === 'string' ? inv.subscription : (inv.subscription?.id || null),
            customerEmail: inv.customer_email || null,
            customerName: inv.customer_name || null,
            items: (inv.lines?.data || []).map((item: any) => ({
                id: item.id,
                description: item.description || null,
                amount: item.amount,
                currency: item.currency,
                quantity: item.quantity,
                period: {
                    start: item.period?.start ? new Date(item.period.start * 1000).toISOString() : null,
                    end: item.period?.end ? new Date(item.period.end * 1000).toISOString() : null,
                },
                priceId: item.price?.id || null,
                productId: typeof item.price?.product === 'string' ? item.price.product : (item.price?.product?.id || null),
            })),
        });

        try {
            const invoiceParams: any = {
                limit: Math.min(Math.max(limit, 1), 100),
            };
            if (stripeCustomerId) {
                invoiceParams.customer = stripeCustomerId;
            } else if (subscriptionId) {
                invoiceParams.subscription = subscriptionId;
            }

            const stripeInvoices = await stripe.invoices.list(invoiceParams);
            return stripeInvoices.data.map(mapInvoice);
        } catch (err: any) {
            if (err.code === 'resource_missing' || err.status === 404 || (err.raw && err.raw.status === 404)) {
                logger.warn(`[getUserInvoices] Customer or Subscription not found on Stripe (${err.message}). Checking email fallback...`);
                if (userEmail && stripeCustomerId) {
                    try {
                        const stripeCustomers = await stripe.customers.list({ email: userEmail, limit: 1 });
                        if (stripeCustomers.data.length > 0 && stripeCustomers.data[0].id !== stripeCustomerId) {
                            const retryInvoices = await stripe.invoices.list({
                                customer: stripeCustomers.data[0].id,
                                limit: Math.min(Math.max(limit, 1), 100),
                            });
                            return retryInvoices.data.map(mapInvoice);
                        }
                    } catch (retryErr: any) {
                        logger.warn(`[getUserInvoices] Retry by email failed: ${retryErr.message}`);
                    }
                }
                return [];
            }
            throw err;
        }
    }
}
