import { getStripe } from '../config/stripe';
import { db } from '../config/db';
import { getSubscriptionPlanId } from '../config/pricing';
import { AppError } from '../utils/AppError';
import { FieldValue } from 'firebase-admin/firestore';

export class SubscriptionService {

    async createSubscription(userId: string, email: string, role: string, country: string, stripeMode?: 'test' | 'live') {
        const stripe = getStripe(stripeMode);
        const priceId = getSubscriptionPlanId(role, country);

        // 1. Find or Create User
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

        // 3. Create Stripe Subscription
        const subscription = await stripe.subscriptions.create({
            customer: stripeCustomerId!,
            items: [{ price: priceId }],
            payment_behavior: 'default_incomplete',
            payment_settings: { save_default_payment_method: 'on_subscription' },
            expand: ['latest_invoice.payment_intent'],
            metadata: { userId: userId, role: role },
        });

        // 4. Save preliminary subscription record
        const subscriptionData = subscription as any;

        // Using Stripe Subscription ID as doc ID
        await db.collection('subscriptions').doc(subscription.id).set({
            userId,
            status: subscription.status,
            planId: priceId,
            currentPeriodEnd: new Date(subscriptionData.current_period_end * 1000),
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });

        const invoice = subscription.latest_invoice as any;
        const paymentIntent = invoice.payment_intent as any;

        return {
            subscriptionId: subscription.id,
            clientSecret: paymentIntent.client_secret,
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

        const newPriceId = getSubscriptionPlanId(newRole, newCountry);

        const stripeSub = await stripe.subscriptions.retrieve(subscriptionId);
        const itemId = stripeSub.items.data[0].id;

        const updatedSub = await stripe.subscriptions.update(subscriptionId, {
            items: [{
                id: itemId,
                price: newPriceId,
            }],
            proration_behavior: 'always_invoice',
        });

        return updatedSub;
    }
}
