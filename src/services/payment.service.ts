import { stripe } from '../config/stripe';
import { db } from '../config/db';
import { getOneTimeFee } from '../config/pricing';
import { AppError } from '../utils/AppError';
import { FieldValue } from 'firebase-admin/firestore';

export class PaymentService {
    /**
     * Create a PaymentIntent for a one-time verification fee.
     */
    async createVerificationPaymentIntent(
        userId: string,
        email: string,
        role: string,
        country: string
    ) {
        // 1. Calculate amount
        const amount = getOneTimeFee(role, country);
        // Dynamic currency: if country is 'IN', use 'inr', else 'usd'
        const currency = country === 'IN' ? 'inr' : 'usd';

        // 2. Find or Create User in 'users' collection
        const userRef = db.collection('users').doc(userId);
        const userDoc = await userRef.get();

        let stripeCustomerId: string | undefined;

        if (!userDoc.exists) {
            // Create new user in DB and Stripe
            const customer = await stripe.customers.create({
                email,
                metadata: { userId, role },
            });
            stripeCustomerId = customer.id;

            await userRef.set({
                email,
                role,
                country,
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
                    if (err.code === 'resource_missing' || err.status === 404) {
                        console.log(`[INFO] Resetting invalid stripeCustomerId ${stripeCustomerId} for user ${userId}`);
                        stripeCustomerId = undefined;
                    } else {
                        throw err; // Rethrow other unexpected errors
                    }
                }
            }

            if (!stripeCustomerId) {
                const customer = await stripe.customers.create({
                    email,
                    metadata: { userId, role },
                });
                stripeCustomerId = customer.id;
                await userRef.update({ stripeCustomerId });
            }
        }

        // 3. Create PaymentIntent
        const paymentIntent = await stripe.paymentIntents.create({
            amount,
            currency,
            customer: stripeCustomerId,
            automatic_payment_methods: { enabled: true },
            metadata: {
                userId: userId,
                type: 'ONE_TIME_VERIFICATION',
            },
        });

        // 4. Log intent in 'payments' collection
        // Using PaymentIntent ID as the document ID
        await db.collection('payments').doc(paymentIntent.id).set({
            userId,
            amount,
            currency,
            status: 'pending',
            type: 'ONE_TIME',
            createdAt: FieldValue.serverTimestamp(),
        });

        return {
            clientSecret: paymentIntent.client_secret,
            paymentIntentId: paymentIntent.id,
        };
    }
    /**
     * Create a Stripe Checkout Session for a one-time verification fee.
     */
    async createVerificationCheckoutSession(
        userId: string,
        email: string,
        role: string,
        country: string,
        successUrl: string,
        cancelUrl: string
    ) {
        // 1. Calculate amount
        const amount = getOneTimeFee(role, country);
        const currency = country === 'IN' ? 'inr' : 'usd';

        // 2. Find or Create User (reuse logic or extract it)
        const userRef = db.collection('users').doc(userId);
        const userDoc = await userRef.get();
        let stripeCustomerId: string | undefined;

        if (!userDoc.exists) {
            const customer = await stripe.customers.create({ email, metadata: { userId, role } });
            stripeCustomerId = customer.id;
            await userRef.set({ email, role, country, stripeCustomerId, createdAt: FieldValue.serverTimestamp() });
        } else {
            const userData = userDoc.data();
            stripeCustomerId = userData?.stripeCustomerId;

            // Check if customer exists in current environment
            if (stripeCustomerId) {
                try {
                    await stripe.customers.retrieve(stripeCustomerId);
                } catch (err: any) {
                    if (err.code === 'resource_missing' || err.status === 404) {
                        stripeCustomerId = undefined;
                    } else {
                        throw err;
                    }
                }
            }

            if (!stripeCustomerId) {
                const customer = await stripe.customers.create({ email, metadata: { userId, role } });
                stripeCustomerId = customer.id;
                await userRef.update({ stripeCustomerId });
            }
        }

        // 3. Create Checkout Session
        const session = await stripe.checkout.sessions.create({
            customer: stripeCustomerId,
            line_items: [
                {
                    price_data: {
                        currency,
                        product_data: {
                            name: `${role.replace('_', ' ')} Identity Verification`,
                            description: `One-time KYC verification fee for ${country}`,
                        },
                        unit_amount: amount,
                    },
                    quantity: 1,
                },
            ],
            mode: 'payment',
            success_url: successUrl,
            cancel_url: cancelUrl,
            payment_intent_data: {
                metadata: {
                    userId,
                    type: 'ONE_TIME_VERIFICATION',
                },
            },
            metadata: {
                userId,
                type: 'ONE_TIME_VERIFICATION',
            },
        });

        return {
            url: session.url,
            sessionId: session.id,
        };
    }

    async verifySession(userId: string, sessionId: string) {
        const session = await stripe.checkout.sessions.retrieve(sessionId);

        if (session.payment_status === 'paid') {
            await db.collection('users').doc(userId).update({
                verified: true,
                verificationStatus: 'verified',
                updatedAt: FieldValue.serverTimestamp(),
            });

            return {
                status: 'success',
                message: 'Payment verified and status updated',
                verified: true
            };
        }

        return {
            status: 'pending',
            message: 'Payment not completed yet',
            verified: false
        };
    }
}
