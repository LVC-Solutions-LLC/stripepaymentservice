import { Request, Response } from 'express';
import { stripe } from '../config/stripe';
import { env } from '../config/env';
import { db } from '../config/db';
import { logger } from '../utils/logger';
import { FieldValue } from 'firebase-admin/firestore';

export const handleStripeWebhook = async (req: Request, res: Response) => {
    const signature = req.headers['stripe-signature'] as string;
    let event;

    const webhookSecret = env.STRIPE_MODE === 'live'
        ? (env.STRIPE_LIVE_WEBHOOK_SECRET || env.STRIPE_WEBHOOK_SECRET)
        : (env.STRIPE_TEST_WEBHOOK_SECRET || env.STRIPE_WEBHOOK_SECRET);

    try {
        event = stripe.webhooks.constructEvent(
            req.body,
            signature,
            webhookSecret
        );
    } catch (err: any) {
        logger.error(`Webhook signature verification failed: ${err.message}`);
        res.status(400).send(`Webhook Error: ${err.message}`);
        return;
    }

    try {
        switch (event.type) {
            case 'payment_intent.succeeded':
                const paymentIntent = event.data.object as any;
                logger.info(`PaymentIntent succeeded: ${paymentIntent.id}`);

                // Doc ID is the PI ID
                await db.collection('payments').doc(paymentIntent.id).set({
                    status: 'succeeded',
                    // Upsert fields if we missed initial creation
                    userId: paymentIntent.metadata.userId || null,
                    amount: paymentIntent.amount,
                    currency: paymentIntent.currency,
                    type: paymentIntent.metadata.type || 'UNKNOWN',
                    updatedAt: FieldValue.serverTimestamp(),
                }, { merge: true });

                // If this was a verification payment, update the user record in Firestore
                if (paymentIntent.metadata?.userId && paymentIntent.metadata?.type === 'ONE_TIME_VERIFICATION') {
                    logger.info(`✅ Mark user ${paymentIntent.metadata.userId} as VERIFIED via PaymentIntent`);
                    await db.collection('users').doc(paymentIntent.metadata.userId).update({
                        verified: true,
                        verificationStatus: 'verified',
                        updatedAt: FieldValue.serverTimestamp(),
                    });
                } else {
                    logger.info(`ℹ️ PaymentIntent ${paymentIntent.id} did not match verification criteria. Metadata: ${JSON.stringify(paymentIntent.metadata)}`);
                }
                break;

            case 'payment_intent.payment_failed':
                const paymentFailed = event.data.object as any;
                logger.warn(`PaymentIntent failed: ${paymentFailed.id}`);
                await db.collection('payments').doc(paymentFailed.id).set({
                    status: 'failed',
                    updatedAt: FieldValue.serverTimestamp(),
                }, { merge: true });
                break;

            case 'customer.subscription.created':
            case 'customer.subscription.updated':
            case 'customer.subscription.deleted':
                const subscription = event.data.object as any;
                logger.info(`Subscription updated: ${subscription.id} status: ${subscription.status}`);

                await db.collection('subscriptions').doc(subscription.id).set({
                    userId: subscription.metadata.userId,
                    status: subscription.status,
                    planId: subscription.items.data[0].price.id,
                    currentPeriodEnd: new Date(subscription.current_period_end * 1000),
                    updatedAt: FieldValue.serverTimestamp(),
                    // Only set createdAt if it doesn't exist? merge: true handles updates
                }, { merge: true });
                break;

            case 'checkout.session.completed':
                const session = event.data.object as any;
                logger.info(`CheckoutSession completed: ${session.id}`);

                // If this was a verification payment, update the user record in Firestore
                if (session.metadata?.userId && session.metadata?.type === 'ONE_TIME_VERIFICATION') {
                    logger.info(`✅ Mark user ${session.metadata.userId} as VERIFIED via CheckoutSession`);
                    await db.collection('users').doc(session.metadata.userId).update({
                        verified: true,
                        verificationStatus: 'verified',
                        updatedAt: FieldValue.serverTimestamp(),
                    });

                    // Also log to payments collection
                    await db.collection('payments').doc(session.id).set({
                        userId: session.metadata.userId,
                        amount: session.amount_total,
                        currency: session.currency,
                        status: 'succeeded',
                        type: 'ONE_TIME_VERIFICATION',
                        updatedAt: FieldValue.serverTimestamp(),
                    }, { merge: true });
                } else {
                    logger.info(`ℹ️ CheckoutSession ${session.id} did not match verification criteria. Metadata: ${JSON.stringify(session.metadata)}`);
                }
                break;

            case 'identity.verification_session.verified':
                const identitySessionVerified = event.data.object as any;
                logger.info(`✅ Identity Verification Session verified: ${identitySessionVerified.id}`);

                if (identitySessionVerified.metadata?.userId) {
                    await db.collection('users').doc(identitySessionVerified.metadata.userId).update({
                        identityVerified: true,
                        identityVerificationStatus: 'verified',
                        updatedAt: FieldValue.serverTimestamp(),
                    });

                    await db.collection('verifications').doc(identitySessionVerified.id).update({
                        status: 'verified',
                        updatedAt: FieldValue.serverTimestamp(),
                    });
                }
                break;

            case 'identity.verification_session.requires_input':
                const identitySessionRequiresInput = event.data.object as any;
                logger.warn(`⚠️ Identity Verification Session requires input: ${identitySessionRequiresInput.id}`);

                if (identitySessionRequiresInput.metadata?.userId) {
                    await db.collection('users').doc(identitySessionRequiresInput.metadata.userId).update({
                        identityVerificationStatus: 'requires_input',
                        updatedAt: FieldValue.serverTimestamp(),
                    });

                    await db.collection('verifications').doc(identitySessionRequiresInput.id).update({
                        status: 'requires_input',
                        updatedAt: FieldValue.serverTimestamp(),
                    });
                }
                break;

            case 'identity.verification_session.processing':
                const identitySessionProcessing = event.data.object as any;
                logger.info(`⏳ Identity Verification Session processing: ${identitySessionProcessing.id}`);

                if (identitySessionProcessing.metadata?.userId) {
                    await db.collection('users').doc(identitySessionProcessing.metadata.userId).update({
                        identityVerificationStatus: 'processing',
                        updatedAt: FieldValue.serverTimestamp(),
                    });

                    await db.collection('verifications').doc(identitySessionProcessing.id).update({
                        status: 'processing',
                        updatedAt: FieldValue.serverTimestamp(),
                    });
                }
                break;

            case 'identity.verification_session.canceled':
            case 'identity.verification_session.redacted':
                const identitySessionFailed = event.data.object as any;
                logger.error(`❌ Identity Verification Session failed/canceled: ${identitySessionFailed.id}`);

                if (identitySessionFailed.metadata?.userId) {
                    await db.collection('users').doc(identitySessionFailed.metadata.userId).update({
                        identityVerificationStatus: 'failed',
                        updatedAt: FieldValue.serverTimestamp(),
                    });

                    await db.collection('verifications').doc(identitySessionFailed.id).update({
                        status: 'failed',
                        updatedAt: FieldValue.serverTimestamp(),
                    });
                }
                break;
        }
    } catch (err: any) {
        logger.error(`Error handling webhook event: ${err.message}`);
        res.status(500).send('Server Error');
        return;
    }

    res.json({ received: true });
};
