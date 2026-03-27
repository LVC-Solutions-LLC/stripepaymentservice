import { getStripe } from '../config/stripe';
import { db } from '../config/db';
import { getSubscriptionPlanId } from '../config/pricing';
import { AppError } from '../utils/AppError';
import { FieldValue } from 'firebase-admin/firestore';

export class SubscriptionService {

    private async getOrCreateSubscriptionProduct(role: string, stripeMode?: 'test' | 'live') {
        const stripe = getStripe(stripeMode);
        const productName = `LVC Fair Job: ${role.replace(/_/g, ' ').toUpperCase()} Subscription`;
        
        // Try to find existing product by name
        const products = await stripe.products.list({ limit: 10, active: true });
        const existing = products.data.find(p => p.name === productName);
        
        if (existing) return existing.id;
        
        // Create new if not found
        const product = await stripe.products.create({
            name: productName,
            description: `Monthly subscription plan for ${role.replace(/_/g, ' ')} roles`,
            metadata: { type: 'SUBSCRIPTION', role: role }
        });
        
        return product.id;
    }

    async createSubscription(userId: string, email: string, role: string, country: string, planId: string = 'standard', stripeMode?: 'test' | 'live') {
        const stripe = getStripe(stripeMode);
        
        // 1. Resolve Product and Pricing
        const productId = await this.getOrCreateSubscriptionProduct(role, stripeMode);
        const pricingDoc = await db.collection('configurations').doc('pricing').get();
        if (!pricingDoc.exists) throw new AppError('Pricing configuration not found', 500);
        
        const subscriptions = pricingDoc.data()?.subscriptions;
        const pricingData = subscriptions?.[role]?.[planId];
        if (!pricingData) throw new AppError(`No subscription plan found for role: ${role}, plan: ${planId}`, 404);

        const countryKey = country === 'IN' ? 'india' : 'global';
        const amount = pricingData[countryKey];
        const currency = country === 'IN' ? 'inr' : 'usd';
        
        if (!amount) throw new AppError(`No price defined for country: ${country}`, 404);

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

        if (!existingSubsSnapshot.empty) {
            throw new AppError('User already has an active subscription', 400);
        }

        // 3. Create Stripe Checkout Session for Subscription
        const session = await stripe.checkout.sessions.create({
            customer: stripeCustomerId!,
            line_items: [{ 
                price_data: {
                    currency: currency,
                    product: productId,
                    unit_amount: amount * 100,
                    recurring: { interval: 'month' },
                },
                quantity: 1,
            }],
            mode: 'subscription',
            success_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard?payment=success&type=subscription&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard?payment=cancel`,
            metadata: { userId, role, planId },
            subscription_data: {
                metadata: { userId, role, planId }
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

        const productId = await this.getOrCreateSubscriptionProduct(newRole, stripeMode);

        const stripeSub = await stripe.subscriptions.retrieve(subscriptionId);
        const itemId = stripeSub.items.data[0].id;

        const updatedSub = await stripe.subscriptions.update(subscriptionId, {
            items: [{
                id: itemId,
                price_data: {
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
