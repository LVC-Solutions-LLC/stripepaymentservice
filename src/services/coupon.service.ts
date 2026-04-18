import { getStripe } from '../config/stripe';
import { db } from '../config/db';
import { AppError } from '../utils/AppError';

export interface CreateCouponPayload {
    /** Human-readable display name shown in Stripe dashboard */
    name: string;
    /** The promotion code string customers enter at checkout (e.g. "LAUNCH50") */
    promoCode: string;
    /** 'percent' for percentage-off, 'fixed' for flat amount off */
    type: 'percent' | 'fixed';
    /** Percentage (0-100) for 'percent', amount in cents/paise for 'fixed' */
    value: number;
    /** Required for 'fixed' type: the currency of the discount */
    currency?: 'inr' | 'usd';
    /** How long the discount applies for new subscriptions */
    duration: 'once' | 'forever' | 'repeating';
    /** Required when duration is 'repeating' */
    durationMonths?: number;
    /** Maximum total redemptions (across all customers). Optional. */
    maxRedemptions?: number;
    /** Optional expiry date as ISO string */
    expiresAt?: string;
    /** Product applicability: empty array means applies to all products */
    stripeProductIds?: string[];
    /** Friendly product keys stored in Firestore for display (e.g. 'subscriptions.job_seeker.standard') */
    productKeys?: string[];
    stripeMode?: 'test' | 'live';
}

export interface CouponRecord {
    id: string;
    name: string;
    promoCode: string;
    stripePromoCodeId: string;
    type: 'percent' | 'fixed';
    value: number;
    currency?: string;
    duration: string;
    durationMonths?: number;
    maxRedemptions?: number;
    expiresAt?: string;
    appliesTo: {
        all: boolean;
        productKeys: string[];
        stripeProductIds: string[];
    };
    active: boolean;
    timesRedeemed: number;
    createdAt: string;
    stripeMode: 'test' | 'live';
}

export class CouponService {

    /**
     * Create a Stripe Coupon + PromotionCode and store the record in Firestore.
     */
    async createCoupon(payload: CreateCouponPayload): Promise<CouponRecord> {
        const {
            name,
            promoCode,
            type,
            value,
            currency,
            duration,
            durationMonths,
            maxRedemptions,
            expiresAt,
            stripeProductIds = [],
            productKeys = [],
            stripeMode = 'test',
        } = payload;

        const stripe = getStripe(stripeMode);

        // Validate fixed-amount coupons require a currency
        if (type === 'fixed' && !currency) {
            throw new AppError('Currency is required for fixed-amount coupons', 400);
        }

        // Validate duration
        if (duration === 'repeating' && (!durationMonths || durationMonths < 1)) {
            throw new AppError('durationMonths must be a positive integer for repeating coupons', 400);
        }

        // Check for duplicate promo code in Firestore first
        const existingSnap = await db.collection('configurations')
            .doc('coupons')
            .collection('list')
            .where('promoCode', '==', promoCode.toUpperCase())
            .where('stripeMode', '==', stripeMode)
            .limit(1)
            .get();

        if (!existingSnap.empty) {
            throw new AppError(`A coupon with promo code "${promoCode.toUpperCase()}" already exists in ${stripeMode} mode`, 409);
        }

        // 1. Create the Stripe Coupon
        const couponParams: any = {
            name,
            duration,
            metadata: {
                managedBy: 'lvc-admin',
                productKeys: productKeys.join(','),
            },
        };

        if (type === 'percent') {
            couponParams.percent_off = value;
        } else {
            couponParams.amount_off = value;
            couponParams.currency = currency!.toLowerCase();
        }

        if (duration === 'repeating') {
            couponParams.duration_months = durationMonths;
        }

        if (maxRedemptions) {
            couponParams.max_redemptions = maxRedemptions;
        }

        if (expiresAt) {
            couponParams.redeem_by = Math.floor(new Date(expiresAt).getTime() / 1000);
        }

        // Stripe applies_to.products: restrict coupon to specific products
        if (stripeProductIds.length > 0) {
            couponParams.applies_to = { products: stripeProductIds };
        }

        const stripeCoupon = await stripe.coupons.create(couponParams);

        // 2. Create the PromotionCode (human-readable code customers enter at checkout)
        const promoCodeParams: any = {
            coupon: stripeCoupon.id,
            code: promoCode.toUpperCase(),
        };

        if (maxRedemptions) {
            promoCodeParams.max_redemptions = maxRedemptions;
        }

        if (expiresAt) {
            promoCodeParams.expires_at = Math.floor(new Date(expiresAt).getTime() / 1000);
        }

        const stripePromoCode = await stripe.promotionCodes.create(promoCodeParams);

        // 3. Build record and store in Firestore
        const record: CouponRecord = {
            id: stripeCoupon.id,
            name,
            promoCode: promoCode.toUpperCase(),
            stripePromoCodeId: stripePromoCode.id,
            type,
            value,
            ...(currency && { currency }),
            duration,
            ...(durationMonths && { durationMonths }),
            ...(maxRedemptions && { maxRedemptions }),
            ...(expiresAt && { expiresAt }),
            appliesTo: {
                all: stripeProductIds.length === 0,
                productKeys,
                stripeProductIds,
            },
            active: true,
            timesRedeemed: 0,
            createdAt: new Date().toISOString(),
            stripeMode,
        };

        await db.collection('configurations')
            .doc('coupons')
            .collection('list')
            .doc(stripeCoupon.id)
            .set(record);

        return record;
    }

    /**
     * List all coupons in Firestore for the given mode, enriched with live redemption counts from Stripe.
     */
    async listCoupons(stripeMode: 'test' | 'live' = 'test'): Promise<CouponRecord[]> {
        const stripe = getStripe(stripeMode);

        // Fetch our internal records
        const snapshot = await db.collection('configurations')
            .doc('coupons')
            .collection('list')
            .where('stripeMode', '==', stripeMode)
            .get();

        const firestoreRecords = new Map<string, CouponRecord>();
        snapshot.docs.forEach(doc => firestoreRecords.set(doc.id, doc.data() as CouponRecord));

        // Fetch live promotion codes from Stripe (source of truth)
        const promoCodes = await stripe.promotionCodes.list({ limit: 100, expand: ['data.coupon'] });

        const records = promoCodes.data.map((promo) => {
            const coupon = (promo as any).coupon;
            const fsRecord = firestoreRecords.get(coupon.id);

            // If we have an internal record, simply enrich it with live stats
            if (fsRecord) {
                fsRecord.active = promo.active;
                fsRecord.timesRedeemed = promo.times_redeemed || coupon.times_redeemed || 0;
                fsRecord.stripePromoCodeId = promo.id;
                return fsRecord;
            }

            // Coupon was created directly inside Stripe Dashboard! Map it to a CouponRecord visually.
            return {
                id: coupon.id,
                name: coupon.name || promo.code,
                promoCode: promo.code,
                stripePromoCodeId: promo.id,
                type: coupon.percent_off ? 'percent' : 'fixed',
                value: coupon.percent_off || coupon.amount_off || 0,
                currency: coupon.currency,
                duration: coupon.duration,
                durationMonths: coupon.duration_months,
                maxRedemptions: promo.max_redemptions || coupon.max_redemptions,
                expiresAt: coupon.redeem_by ? new Date(coupon.redeem_by * 1000).toISOString() : undefined,
                appliesTo: {
                    all: !coupon.applies_to || !coupon.applies_to.products || coupon.applies_to.products.length === 0,
                    productKeys: coupon.metadata?.productKeys ? coupon.metadata.productKeys.split(',') : [],
                    stripeProductIds: coupon.applies_to?.products || [],
                },
                active: promo.active,
                timesRedeemed: promo.times_redeemed || coupon.times_redeemed || 0,
                createdAt: new Date(promo.created * 1000).toISOString(),
                stripeMode,
            } as CouponRecord;
        });

        // Add any internal records that fell outside the Stripe 100 limit (if any)
        const existingStripeIds = new Set(records.map(r => r.id));
        for (const fsRecord of firestoreRecords.values()) {
            if (!existingStripeIds.has(fsRecord.id)) {
                records.push(fsRecord);
            }
        }

        // Sort by newest first
        records.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

        return records;
    }

    /**
     * Deactivate a coupon: archive in Stripe + mark inactive in Firestore.
     * Stripe does not support deleting coupons that have been redeemed, so we archive instead.
     */
    async deactivateCoupon(couponId: string, stripeMode: 'test' | 'live' = 'test'): Promise<void> {
        const stripe = getStripe(stripeMode);

        const docRef = db.collection('configurations')
            .doc('coupons')
            .collection('list')
            .doc(couponId);

        const docSnap = await docRef.get();
        if (!docSnap.exists) {
            throw new AppError('Coupon not found in Firestore', 404);
        }

        const record = docSnap.data() as CouponRecord;

        // Deactivate the PromotionCode so it can no longer be entered at checkout
        if (record.stripePromoCodeId) {
            try {
                await stripe.promotionCodes.update(record.stripePromoCodeId, { active: false });
            } catch (err: any) {
                if (err.statusCode !== 404) throw err;
            }
        }

        // Delete the underlying coupon (Stripe allows deletion of unused coupons)
        // For redeemed coupons, Stripe prevents deletion – we catch and continue
        try {
            await stripe.coupons.del(couponId);
        } catch (err: any) {
            if (err.statusCode !== 404) {
                // If deletion fails (e.g. has redemptions), just mark inactive via update
                // Stripe doesn't have a direct "deactivate" for coupons, but deleting the
                // promotion code above already prevents new uses
                console.warn(`[CouponService] Could not delete Stripe coupon ${couponId}: ${err.message}`);
            }
        }

        // Update Firestore
        await docRef.update({ active: false });
    }

    /**
     * Helper: look up the Stripe Product IDs from the pricing config for given product keys.
     * Keys are dot-notation paths like 'subscriptions.job_seeker.standard' or 'oneTime.company'.
     */
    async resolveStripeProductIds(productKeys: string[]): Promise<string[]> {
        if (productKeys.length === 0) return [];

        const pricingDoc = await db.collection('configurations').doc('pricing').get();
        if (!pricingDoc.exists) {
            throw new AppError('Pricing configuration not found. Please sync pricing first.', 500);
        }

        const pricingData = pricingDoc.data()!;
        const ids: string[] = [];

        for (const key of productKeys) {
            const parts = key.split('.');
            // Navigate the nested pricingData object
            let current: any = pricingData;
            for (const part of parts) {
                current = current?.[part];
                if (!current) break;
            }

            // stripeProductId can be directly on the node OR on india/global sub-objects
            if (current?.stripeProductId) {
                ids.push(current.stripeProductId);
            } else {
                // collect from india/global if nested
                if (current?.india?.stripeProductId) ids.push(current.india.stripeProductId);
                if (current?.global?.stripeProductId) ids.push(current.global.stripeProductId);
            }
        }

        return [...new Set(ids)]; // dedupe
    }
}
