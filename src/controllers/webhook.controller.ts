import { Request, Response } from 'express';
import { stripe } from '../config/stripe';
import { env } from '../config/env';
import { db } from '../config/db';
import { logger } from '../utils/logger';
import { FieldValue } from 'firebase-admin/firestore';
import { IdentityService } from '../services/identity.service';

const identityService = new IdentityService();

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
                    const userId = paymentIntent.metadata.userId;
                    const registrationId = paymentIntent.metadata.registrationId;

                    if (registrationId) {
                        logger.info(`✅ Mark company verification payment for user ${userId}, registration ${registrationId} as paid via PaymentIntent`);
                        
                        // 1. Update verification case
                        const caseId = `CASE-COMPANY-${registrationId.slice(0, 8).toUpperCase()}`;
                        await db.collection('verifications').doc(caseId).update({
                            paymentStatus: 'paid',
                            paidAt: FieldValue.serverTimestamp(),
                            updatedAt: FieldValue.serverTimestamp(),
                        }).catch(err => logger.error(`Failed to update verification case ${caseId}: ${err.message}`));

                        // 2. Update company record — guard against overwriting an already-approved status
                        const companySnap = await db.collection('companies').doc(registrationId).get();
                        const curVerStatus = companySnap.data()?.verificationStatus;
                        const protectedStatuses = ['approved', 'verified', 'decision_pending'];
                        const companyPaymentUpdate: any = { paymentStatus: 'paid', updatedAt: FieldValue.serverTimestamp() };
                        if (!protectedStatuses.includes(curVerStatus)) companyPaymentUpdate.verificationStatus = 'under_review';
                        await db.collection('companies').doc(registrationId).update(companyPaymentUpdate)
                            .catch(err => logger.error(`Failed to update company record ${registrationId}: ${err.message}`));

                        // 3. Mark user fee as paid but DO NOT auto-verify
                        await db.collection('users').doc(userId).update({
                            oneTimeFeeStatus: 'paid',
                            updatedAt: FieldValue.serverTimestamp(),
                        });
                    } else {
                        logger.info(`✅ Mark personal user ${userId} as VERIFIED via PaymentIntent (No registrationId)`);
                        await db.collection('users').doc(userId).update({
                            verified: true,
                            verificationStatus: 'verified',
                            oneTimeFeeStatus: 'paid',
                            updatedAt: FieldValue.serverTimestamp(),
                        });
                    }
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
                const subUserId = subscription.metadata.userId;
                // Use metadata planId (e.g. '1_seat') first. Fall back to price ID only as last resort.
                const subPlanId = subscription.metadata.planId || null;
                const subRole = subscription.metadata.role || 'job_seeker';
                
                logger.info(`Subscription ${subscription.id} for user ${subUserId} reached status: ${subscription.status}`);

                if (subUserId) {
                    const subData = {
                        userId: subUserId,
                        status: subscription.status,
                        planId: subPlanId, // Our logical plan name e.g. '1_seat'
                        stripePriceId: subscription.items.data[0]?.price?.id || null, // raw Stripe price ID stored separately
                        role: subRole,
                        currentPeriodEnd: new Date(subscription.current_period_end * 1000),
                        updatedAt: FieldValue.serverTimestamp(),
                    };

                    await db.collection('subscriptions').doc(subscription.id).set(subData, { merge: true });

                    // Also update the main user record for legacy compatibility
                    const userUpdate: any = {};
                    if (subRole === 'job_seeker') {
                        userUpdate.jobSeekerSubscription = {
                            subscriptionId: subscription.id,
                            jobSeekerPremiumStatus: subscription.status === 'active' || subscription.status === 'trialing' ? subPlanId : 'free',
                            lastUpdated: FieldValue.serverTimestamp(),
                        };
                    } else if (subRole === 'company') {
                        userUpdate.recruiterSubscription = {
                            subscriptionId: subscription.id,
                            status: subscription.status,
                            planId: subPlanId,
                            lastUpdated: FieldValue.serverTimestamp(),
                        };
                    }

                    await db.collection('users').doc(subUserId).update(userUpdate).catch(err => {
                        logger.error(`Failed to update user record for subscription: ${err.message}`);
                    });
                }
                break;

            case 'checkout.session.completed':
                const session = event.data.object as any;
                logger.info(`CheckoutSession completed: ${session.id}`);

                if (session.metadata?.userId && session.metadata?.type === 'LAYOFF_PAYMENT') {
                    logger.info(`✅ Mark user ${session.metadata.userId} LAYOFF_PAYMENT as completed via CheckoutSession`);
                    const registrationId = session.metadata.registrationId;
                    const planId = session.metadata.planId;
                    const amountTotal = session.amount_total ? session.amount_total / 100 : 0;
                    const currency = session.currency?.toUpperCase() || 'USD';

                    if (registrationId) {
                        await db.collection('layoffRegistrations').doc(registrationId).update({
                            layoffPaymentStatus: 'completed',
                            status: 'under_review',
                            subscriptionPlan: {
                                planId: planId || 'layoff_unknown',
                                planName: planId ? planId.replace('layoff_', '').toUpperCase() : 'Layoff Plan',
                                price: `${amountTotal} ${currency}`
                            },
                            updatedAt: FieldValue.serverTimestamp(),
                        });
                    }

                    await db.collection('payments').doc(session.id).set({
                        userId: session.metadata.userId,
                        amount: session.amount_total,
                        currency: session.currency,
                        status: 'succeeded',
                        type: 'LAYOFF_PAYMENT',
                        registrationId: registrationId || null,
                        planId: planId || null,
                        updatedAt: FieldValue.serverTimestamp(),
                    }, { merge: true });

                } else if (session.metadata?.userId && session.metadata?.type === 'ONE_TIME_VERIFICATION') {
                    const userId = session.metadata.userId;
                    const registrationId = session.metadata.registrationId;

                    if (registrationId) {
                        logger.info(`✅ Mark company verification payment for user ${userId}, registration ${registrationId} as paid via CheckoutSession`);
                        
                        // 1. Update verification case
                        const caseId = `CASE-COMPANY-${registrationId.slice(0, 8).toUpperCase()}`;
                        await db.collection('verifications').doc(caseId).update({
                            paymentStatus: 'paid',
                            paidAt: FieldValue.serverTimestamp(),
                            updatedAt: FieldValue.serverTimestamp(),
                        }).catch(err => logger.error(`Failed to update verification case ${caseId}: ${err.message}`));

                        // 2. Update company record — guard against overwriting an already-approved status
                        const companySnap2 = await db.collection('companies').doc(registrationId).get();
                        const curVerStatus2 = companySnap2.data()?.verificationStatus;
                        const protectedStatuses2 = ['approved', 'verified', 'decision_pending'];
                        const companyPaymentUpdate2: any = { paymentStatus: 'paid', updatedAt: FieldValue.serverTimestamp() };
                        if (!protectedStatuses2.includes(curVerStatus2)) companyPaymentUpdate2.verificationStatus = 'under_review';
                        await db.collection('companies').doc(registrationId).update(companyPaymentUpdate2)
                            .catch(err => logger.error(`Failed to update company record ${registrationId}: ${err.message}`));

                        // 3. Mark user fee as paid but DO NOT auto-verify
                        await db.collection('users').doc(userId).update({
                            oneTimeFeeStatus: 'paid',
                            updatedAt: FieldValue.serverTimestamp(),
                        });
                    } else {
                        logger.info(`✅ Mark personal user ${userId} as VERIFIED via CheckoutSession (No registrationId)`);
                        await db.collection('users').doc(userId).update({
                            verified: true,
                            verificationStatus: 'verified',
                            oneTimeFeeStatus: 'paid',
                            updatedAt: FieldValue.serverTimestamp(),
                        });
                    }

                    // Also log to payments collection
                    await db.collection('payments').doc(session.id).set({
                        userId: session.metadata.userId,
                        amount: session.amount_total,
                        currency: session.currency,
                        status: 'succeeded',
                        type: 'ONE_TIME_VERIFICATION',
                        updatedAt: FieldValue.serverTimestamp(),
                    }, { merge: true });
                } else if (session.metadata?.userId && session.metadata?.type === 'ONE_TIME_ADDON') {
                    const userId = session.metadata.userId;
                    const registrationId = session.metadata.registrationId;
                    const addonId = session.metadata.addonId;

                    logger.info(`✅ Processing ONE_TIME_ADDON purchase: ${addonId} for company ${registrationId}`);

                    if (registrationId && addonId) {
                        const companyRef = db.collection('companies').doc(registrationId);
                        const companySnap = await companyRef.get();
                        const companyData = companySnap.data() || {};
                        const existingAddons = Array.isArray(companyData.addonPurchases) ? companyData.addonPurchases : [];
                        const addonAlreadyRecorded = existingAddons.some((addon: any) => addon?.sessionId && addon.sessionId === session.id);

                        if (!addonAlreadyRecorded) {
                            const purchasedAt = new Date();
                            const expiresAt = new Date(purchasedAt);
                            expiresAt.setDate(expiresAt.getDate() + 30);

                            // Increment specific limits based on addonId along with pushing to the array
                            const updateData: any = {
                                updatedAt: FieldValue.serverTimestamp()
                            };

                            if (addonId === 'extra_recruiter_seat') {
                                updateData.extraRecruiterSeats = FieldValue.increment(1);
                                logger.info(`➕ Incrementing extraRecruiterSeats for ${registrationId}`);
                            } else if (addonId === 'extra_job_posting') {
                                updateData.extraJobPostings = FieldValue.increment(1);
                                logger.info(`➕ Incrementing extraJobPostings for ${registrationId}`);
                            }

                            updateData.addonPurchases = FieldValue.arrayUnion({
                                type: addonId,
                                quantity: 1,
                                purchasedAt,
                                expiresAt,
                                sessionId: session.id,
                                status: 'active',
                            });

                            await companyRef.update(updateData).catch(err => {
                                logger.error(`❌ Failed to record addon purchase history and limit for ${addonId}: ${err.message}`);
                            });
                        } else {
                            logger.info(`ℹ️ Addon ${addonId} for session ${session.id} already recorded. Skipping.`);
                        }
                    }

                    // Log to payments collection
                    await db.collection('payments').doc(session.id).set({
                        userId: session.metadata.userId,
                        amount: session.amount_total,
                        currency: session.currency,
                        status: 'succeeded',
                        type: 'ONE_TIME_ADDON',
                        addonId: addonId || null,
                        registrationId: registrationId || null,
                        updatedAt: FieldValue.serverTimestamp(),
                    }, { merge: true });

                } else {
                    logger.info(`ℹ️ CheckoutSession ${session.id} did not match verification criteria. Metadata: ${JSON.stringify(session.metadata)}`);
                }
                break;

            case 'identity.verification_session.verified':
                const identitySessionVerified = event.data.object as any;
                logger.info(`✅ Identity Verification Session verified: ${identitySessionVerified.id}`);

                // Delegate to service which handles:
                //   1. Name match check (form name vs Stripe verified_outputs)
                //   2. Duplicate-person detection (SHA-256 fingerprint of name + DOB)
                //   3. Final Firestore status write
                await identityService.validateAndFinalizeVerification(identitySessionVerified);
                break;

            case 'identity.verification_session.requires_input':
                const identitySessionRequiresInput = event.data.object as any;
                logger.warn(`⚠️ Identity Verification Session requires input: ${identitySessionRequiresInput.id}`);

                if (identitySessionRequiresInput.metadata?.userId) {
                    await db.collection('users').doc(identitySessionRequiresInput.metadata.userId).update({
                        identityVerificationStatus: 'requires_input',
                        identityDocumentStatus: 'requires_input',
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
                        identityDocumentStatus: 'processing',
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
                        identityDocumentStatus: 'failed',
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
