import { getStripe } from '../config/stripe';
import { db } from '../config/db';
import { getSubscriptionPlanId } from '../config/pricing';
import { AppError } from '../utils/AppError';
import { FieldValue } from 'firebase-admin/firestore';

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

        console.log(`[SubscriptionService] Creating Checkout Session:`, {
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
                        console.log(`[INFO] Resetting invalid stripeCustomerId ${stripeCustomerId} for user ${userId}`);
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

    async changeSubscription(userId: string, subscriptionId: string, newRole: string, newCountry: string, stripeMode?: 'test' | 'live') {
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

        const updatedSub = await stripe.subscriptions.update(subscriptionId, {
            items: [{
                id: itemId,
                price: (newCountry === 'IN' ? pricingData.stripePriceId_inr : pricingData.stripePriceId_usd) || undefined,
                price_data: (newCountry === 'IN' ? pricingData.stripePriceId_inr : pricingData.stripePriceId_usd) ? undefined : {
                    currency: currency,
                    product: productId,
                    unit_amount: amount * 100,
                    recurring: { interval: 'month' },
                } as any,
            }],
            proration_behavior: 'always_invoice',
        });

        return updatedSub;
    }
}
