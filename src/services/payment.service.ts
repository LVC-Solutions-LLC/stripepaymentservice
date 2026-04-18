import { getStripe } from '../config/stripe';
import { db } from '../config/db';
import { getOneTimeFee } from '../config/pricing';
import { AppError } from '../utils/AppError';
import { FieldValue } from 'firebase-admin/firestore';
import { logger } from '../utils/logger';

export class PaymentService {
    /**
     * Create a PaymentIntent for a one-time verification fee.
     */
    async createVerificationPaymentIntent(
        userId: string,
        email: string,
        role: string,
        country: string,
        stripeMode?: 'test' | 'live'
    ) {
        const stripe = getStripe(stripeMode);
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
                    if (err.code === 'resource_missing' || err.status === 404 || (err.raw && err.raw.status === 404)) {
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

    private async getOrCreateOneTimeProduct(role: string, stripeMode?: 'test' | 'live') {
        const stripe = getStripe(stripeMode);
        
        // 1. Check if we already have it in Firestore
        const pricingDoc = await db.collection('configurations').doc('pricing').get();
        if (pricingDoc.exists) {
            const oneTimeFees = pricingDoc.data()?.oneTime;
            const stripeProductId = oneTimeFees?.[role]?.stripeProductId;
            if (stripeProductId) return stripeProductId;
        }

        const productName = `LVC Fair Job: ${role.replace(/_/g, ' ').toUpperCase()} Identity Verification`;
        
        // 2. Try to find existing product by name in Stripe
        const products = await stripe.products.list({ limit: 10, active: true });
        const existing = products.data.find(p => p.name === productName);
        
        let productId: string;
        if (existing) {
            productId = existing.id;
        } else {
            // 3. Create new if not found in Stripe
            const product = await stripe.products.create({
                name: productName,
                description: `One-time identity verification fee for ${role.replace(/_/g, ' ')} roles`,
                metadata: { type: 'ONE_TIME', role: role }
            });
            productId = product.id;
        }

        // 4. Store the productId in Firestore for future use
        await db.collection('configurations').doc('pricing').set({
            oneTime: {
                [role]: {
                    stripeProductId: productId
                }
            }
        }, { merge: true });

        return productId;
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
        cancelUrl: string,
        stripeMode?: 'test' | 'live',
        planId?: string,
        amount?: number,
        currency?: string,
        label?: string,
        registrationId?: string,
        type?: string,
        addonId?: string,
        inputPriceId?: string
    ) {
        const stripe = getStripe(stripeMode);
        
        // 1. Resolve Product and Pricing
        let productId = await this.getOrCreateOneTimeProduct(role, stripeMode);
        const pricingDoc = await db.collection('configurations').doc('pricing').get();
        const pricingData = pricingDoc.data() || {};
        
        let oneTimeData: any = null;
        const isLayoff = planId?.startsWith('layoff_');
        const layoffTierId = isLayoff ? planId?.replace('layoff_', '') : null;

        if (isLayoff && layoffTierId) {
            oneTimeData = pricingData.subscriptions?.layoff_mode?.[layoffTierId];
        } else if (type === 'ONE_TIME_ADDON' && addonId) {
            oneTimeData = pricingData.addons?.[addonId];
        } else {
            oneTimeData = pricingData.verificationFees?.[role] || pricingData.oneTime?.[role];
        }
        const isIndia = country === 'IN';
        const countryKey = isIndia ? 'india' : 'global';
        const regionData = oneTimeData?.[countryKey];

        // Robust numeric resolution: prefer new region-nested price, then legacy flat price, then hardcoded default
        const dbAmountNumeric = isIndia 
            ? (Number(regionData?.price_inr || regionData || oneTimeData?.price_inr || oneTimeData?.india || oneTimeData?.IN) || 0)
            : (Number(regionData?.price_usd || regionData || oneTimeData?.price_usd || oneTimeData?.global || oneTimeData?.US) || 0);

        // 2. Calculate amount & currency
        const finalizedCurrency = (currency || (isIndia ? 'inr' : 'usd')).toLowerCase();
        // Use provided amount (major units -> * 100) or DB amount (minor units) or hardcoded default
        const finalizedAmount = amount 
             ? Math.round(Number(amount) * 100) 
             : (dbAmountNumeric > 0 ? dbAmountNumeric : getOneTimeFee(role, country));
        
        const finalizedLabel = label || (addonId ? addonId.split('_').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : `${role.replace(/_/g, ' ').toUpperCase()} Identity Verification`);
        const finalizedDescription = label ? `Payment for ${label}` : `One-time KYC verification fee for ${country}`;

        // 2. Find or Create User
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

            if (stripeCustomerId) {
                try {
                    await stripe.customers.retrieve(stripeCustomerId);
                } catch (err: any) {
                    if (err.code === 'resource_missing' || err.status === 404 || (err.raw && err.raw.status === 404)) {
                        console.log(`[INFO] Resetting invalid stripeCustomerId ${stripeCustomerId} for user ${userId}`);
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

        // Resolve Price ID
        const priceId = inputPriceId || (isIndia 
            ? (regionData?.stripePriceId_inr || oneTimeData?.stripePriceId_inr) 
            : (regionData?.stripePriceId_usd || oneTimeData?.stripePriceId_usd));

        // Use synced Product ID if available for add-ons
        if (oneTimeData?.stripeProductId) {
            productId = oneTimeData.stripeProductId;
        } else if (regionData?.stripeProductId) {
             productId = regionData.stripeProductId;
        }

        // 3. Create Checkout Session
        const session = await stripe.checkout.sessions.create({
            customer: stripeCustomerId,
            line_items: [
                {
                    price: priceId || undefined,
                    price_data: priceId ? undefined : {
                        currency: finalizedCurrency,
                        product: productId,
                        unit_amount: finalizedAmount,
                    },
                    quantity: 1,
                },
            ],
            mode: 'payment',
            allow_promotion_codes: true,
            success_url: successUrl,
            cancel_url: cancelUrl,
            payment_intent_data: {
                metadata: {
                    userId,
                    type: isLayoff ? 'LAYOFF_PAYMENT' : 'ONE_TIME_VERIFICATION',
                    registrationId: registrationId || '',
                    planId: planId || '',
                },
            },
            metadata: {
                userId,
                type: type || (isLayoff ? 'LAYOFF_PAYMENT' : 'ONE_TIME_VERIFICATION'),
                registrationId: registrationId || '',
                planId: planId || '',
                addonId: addonId || '',
            },
        });

        return {
            url: session.url,
            sessionId: session.id,
        };
    }

    async verifySession(userId: string, sessionId: string, stripeMode?: 'test' | 'live') {
        try {
            const stripe = getStripe(stripeMode);
            const session = await stripe.checkout.sessions.retrieve(sessionId);

            if (session.payment_status === 'paid') {
                const metadata = session.metadata || {};
                const type = metadata.type;
                logger.debug(`💳 [PaymentService] Verifying Stripe session metadata:`, metadata);

                if (type === 'LAYOFF_PAYMENT') {
                    const registrationId = metadata.registrationId;
                    const planId = metadata.planId;
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
                    
                    return {
                        status: 'success',
                        message: 'Layoff payment verified',
                        verified: true,
                        type,
                        registrationId,
                        planId,
                        amountTotal,
                        currency
                    };
                }

                if (type === 'ONE_TIME_ADDON') {
                    const registrationId = metadata.registrationId;
                    const addonId = metadata.addonId;
                    const quantity = Number(metadata.quantity || 1);

                    if (registrationId && addonId) {
                        const companyRef = db.collection('companies').doc(registrationId);
                        
                        await db.runTransaction(async (transaction) => {
                            const companySnap = await transaction.get(companyRef);
                            const companyData = companySnap.data() || {};
                            const existingAddons = Array.isArray(companyData.addonPurchases) ? companyData.addonPurchases : [];
                            const addonAlreadyRecorded = existingAddons.some((addon: any) => addon?.sessionId && addon.sessionId === session.id);

                            if (!addonAlreadyRecorded) {
                                const purchasedAt = new Date();
                                const expiresAt = new Date(purchasedAt);
                                expiresAt.setDate(expiresAt.getDate() + 30);

                                const updateData: any = {
                                    updatedAt: FieldValue.serverTimestamp()
                                };

                                if (addonId === 'extra_recruiter_seat') {
                                    updateData.extraRecruiterSeats = FieldValue.increment(1);
                                    logger.info(`[verifySession] ➕ Incrementing extraRecruiterSeats for ${registrationId}`);
                                } else if (addonId === 'extra_job_posting') {
                                    updateData.extraJobPostings = FieldValue.increment(1);
                                    logger.info(`[verifySession] ➕ Incrementing extraJobPostings for ${registrationId}`);
                                }

                                updateData.addonPurchases = FieldValue.arrayUnion({
                                    type: addonId,
                                    quantity: 1,
                                    purchasedAt,
                                    expiresAt,
                                    sessionId: session.id,
                                    status: 'active',
                                });

                                transaction.update(companyRef, updateData);
                            }
                        }).catch(err => {
                            logger.error(`[verifySession] ❌ Transaction failed for ${addonId}: ${err.message}`);
                        });
                    }

                    return {
                        status: 'success',
                        message: 'Addon payment verified',
                        verified: true,
                        type,
                        addonId,
                        registrationId,
                        quantity,
                        sessionId: session.id,
                    };
                }

                if (type === 'SUBSCRIPTION') {
                    const subscriptionId = session.subscription as string;
                    const planId = metadata.planId || 'standard';
                    const role = metadata.role || 'job_seeker';
                    const registrationId = metadata.registrationId;

                    if (subscriptionId) {
                        const subRef = db.collection('subscriptions').doc(subscriptionId);
                        const subDoc = await subRef.get();

                        if (!subDoc.exists) {
                            const stripe = getStripe(stripeMode);
                            const stripeSub = await stripe.subscriptions.retrieve(subscriptionId);
                            
                            await subRef.set({
                                id: subscriptionId,
                                userId,
                                role,
                                planId,
                                registrationId,
                                status: 'active',
                                currentPeriodEnd: new Date((stripeSub as any).current_period_end * 1000),
                                createdAt: FieldValue.serverTimestamp(),
                                updatedAt: FieldValue.serverTimestamp(),
                                customerId: session.customer as string,
                                metadata: metadata
                            });
                            logger.info(`✅ [PaymentService] Created subscription record for ${subscriptionId}`);
                        }
                    }

                    if (planId?.startsWith('layoff_') && registrationId) {
                        const amountTotal = session.amount_total ? session.amount_total / 100 : 0;
                        const currency = session.currency?.toUpperCase() || 'USD';
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
                        logger.info(`✅ [PaymentService] Updated layoffRegistrations status to completed for ${registrationId}`);
                    }

                    return {
                        status: 'success',
                        message: 'Subscription verified and recorded',
                        verified: true,
                        type: 'SUBSCRIPTION',
                        planId: planId
                    };
                }

                let registrationId = metadata.registrationId;

                // Robust Fallback: If registrationId is missing from metadata, check user document
                if (!registrationId && userId) {
                    try {
                        const userDoc = await db.collection('users').doc(userId).get();
                        if (userDoc.exists) {
                            registrationId = userDoc.data()?.companyId;
                            logger.info(`🔍 [PaymentService] Recovered registrationId ${registrationId} from user doc for ${userId}`);
                        }
                    } catch (err: any) {
                        logger.error(`❌ [PaymentService] User document lookup fallback failed:`, err.message);
                    }
                }

                if (registrationId) {
                    // 1. Update verification case
                    const caseId = `CASE-COMPANY-${registrationId.slice(0, 8).toUpperCase()}`;
                    await db.collection('verifications').doc(caseId).update({
                        paymentStatus: 'paid',
                        paidAt: FieldValue.serverTimestamp(),
                        updatedAt: FieldValue.serverTimestamp(),
                    }).catch(() => {});

                    // 2. Update company record
                    await db.collection('companies').doc(registrationId).update({
                        paymentStatus: 'paid',
                        verificationStatus: 'under_review',
                        updatedAt: FieldValue.serverTimestamp(),
                    }).catch(() => {});

                    // 3. Mark user fee as paid but DO NOT auto-verify
                    await db.collection('users').doc(userId).update({
                        oneTimeFeeStatus: 'paid',
                        updatedAt: FieldValue.serverTimestamp(),
                    });
                } else {
                    await db.collection('users').doc(userId).update({
                        verified: true,
                        verificationStatus: 'verified',
                        oneTimeFeeStatus: 'paid',
                        updatedAt: FieldValue.serverTimestamp(),
                    });
                }

                return {
                    status: 'success',
                    message: 'Payment verified and status updated',
                    verified: true,
                    registrationId: registrationId
                };
            }

            return {
                status: 'pending',
                message: 'Payment not completed yet',
                verified: false
            };
        } catch (error: any) {
            logger.error(`❌ Error verifying session ${sessionId}:`, error);
            return { status: 'error', message: error.message };
        }
    }
}
