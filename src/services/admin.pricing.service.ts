import { getStripe } from '../config/stripe';
import { db } from '../config/db';
import { AppError } from '../utils/AppError';
import { logger } from '../utils/logger';

export class AdminPricingService {
    async syncStripeProduct(payload: {
        type: 'ONE_TIME' | 'SUBSCRIPTION';
        role: string;
        tier?: string;
        stripeProductId?: string | null;
        stripePriceId_inr?: string | null;
        stripePriceId_usd?: string | null;
        indiaPricePaise: number;
        globalPriceCents: number;
        name: string;
        description?: string;
    }, stripeMode?: 'test' | 'live', options?: { skipFirestoreUpdate?: boolean }) {
        const stripe = getStripe(stripeMode);
        let { type, role, tier, stripeProductId, stripePriceId_inr, stripePriceId_usd, indiaPricePaise, globalPriceCents, name, description } = payload;

        // 1. Resolve or Create Product
        if (!stripeProductId) {
            // First search existing active products in Stripe by metadata or name before creating a new one!
            try {
                const existingProducts = await stripe.products.list({ limit: 100, active: true });
                const match = existingProducts.data.find(p => 
                    (p.metadata?.role === role && p.metadata?.tier === (tier || '') && p.metadata?.type === type) ||
                    p.name === name ||
                    p.name === `${name} (India)` ||
                    p.name === `${name} (Global)`
                );
                if (match) {
                    stripeProductId = match.id;
                }
            } catch (e) {
                // Ignore lookup errors and proceed
            }

            if (!stripeProductId) {
                const product = await stripe.products.create({
                    name: name,
                    description: description || `Pricing tier for ${role} ${tier || ''}`,
                    metadata: { type, role, tier: tier || '' }
                });
                stripeProductId = product.id;
            }
        } else {
            // Update existing
            try {
                await stripe.products.update(stripeProductId, {
                    name: name,
                    description: description || `Pricing tier for ${role} ${tier || ''}`,
                });
            } catch (err: any) {
                // If product does not exist in current Stripe account (e.g. account switch or stale ID), create a new one!
                if (err.code === 'resource_missing' || err.statusCode === 404 || err.message?.includes('No such product')) {
                    const product = await stripe.products.create({
                        name: name,
                        description: description || `Pricing tier for ${role} ${tier || ''}`,
                        metadata: { type, role, tier: tier || '' }
                    });
                    stripeProductId = product.id;
                } else {
                    throw err;
                }
            }
        }

        // 2. Sync Prices (create new if amount changed) in parallel for INR and USD
        const syncPrice = async (amount: number, currency: string, existingPriceId?: string | null) => {
            if (!amount || amount <= 0) return undefined;
            let needsNewPrice = true;
            if (existingPriceId) {
                try {
                    const price = await stripe.prices.retrieve(existingPriceId);
                    if (price.unit_amount === amount && price.currency === currency.toLowerCase() && price.active) {
                        needsNewPrice = false;
                    } else if (price.active) {
                        await stripe.prices.update(existingPriceId, { active: false });
                    }
                } catch (err) {
                    // Price missing or inactive, will create new
                }
            }

            if (needsNewPrice) {
                const newPrice = await stripe.prices.create({
                    product: stripeProductId!,
                    unit_amount: Math.round(amount),
                    currency: currency.toLowerCase(),
                    recurring: type === 'SUBSCRIPTION' ? { interval: 'month' } : undefined,
                });
                return newPrice.id;
            }
            return existingPriceId;
        };

        const [newPriceIdInr, newPriceIdUsd] = await Promise.all([
            syncPrice(indiaPricePaise, 'INR', stripePriceId_inr),
            syncPrice(globalPriceCents, 'USD', stripePriceId_usd),
        ]);

        if (!options?.skipFirestoreUpdate) {
            // 3. Update Firestore back with new Price IDs if single product sync
            const updateData: any = {};
            if (role === 'addon' && tier) {
                // Dual-sync: Update root AND regional nested objects
                updateData[`addons.${tier}.stripeProductId`] = stripeProductId;
                updateData[`addons.${tier}.stripePriceId_inr`] = newPriceIdInr;
                updateData[`addons.${tier}.stripePriceId_usd`] = newPriceIdUsd;

                updateData[`addons.${tier}.india.stripePriceId_inr`] = newPriceIdInr;
                updateData[`addons.${tier}.india.stripeProductId`] = stripeProductId;
                updateData[`addons.${tier}.global.stripePriceId_usd`] = newPriceIdUsd;
                updateData[`addons.${tier}.global.stripeProductId`] = stripeProductId;
            } else if (type === 'ONE_TIME') {
                // Dual-sync for verification fees
                updateData[`oneTime.${role}.stripeProductId`] = stripeProductId;
                updateData[`oneTime.${role}.stripePriceId_inr`] = newPriceIdInr;
                updateData[`oneTime.${role}.stripePriceId_usd`] = newPriceIdUsd;
                
                updateData[`oneTime.${role}.india.stripePriceId_inr`] = newPriceIdInr;
                updateData[`oneTime.${role}.india.stripeProductId`] = stripeProductId;
                updateData[`oneTime.${role}.global.stripePriceId_usd`] = newPriceIdUsd;
                updateData[`oneTime.${role}.global.stripeProductId`] = stripeProductId;
            } else if (tier) {
                // Dual-sync for subscriptions
                updateData[`subscriptions.${role}.${tier}.stripeProductId`] = stripeProductId;
                updateData[`subscriptions.${role}.${tier}.stripePriceId_inr`] = newPriceIdInr;
                updateData[`subscriptions.${role}.${tier}.stripePriceId_usd`] = newPriceIdUsd;

                updateData[`subscriptions.${role}.${tier}.india.stripePriceId_inr`] = newPriceIdInr;
                updateData[`subscriptions.${role}.${tier}.india.stripeProductId`] = stripeProductId;
                updateData[`subscriptions.${role}.${tier}.global.stripePriceId_usd`] = newPriceIdUsd;
                updateData[`subscriptions.${role}.${tier}.global.stripeProductId`] = stripeProductId;
            }

            await db.collection('configurations').doc('pricing').update(updateData);
        }

        return {
            stripeProductId,
            stripePriceId_inr: newPriceIdInr,
            stripePriceId_usd: newPriceIdUsd,
        };
    }

    async syncFullPricingConfig(config: any, stripeMode?: 'test' | 'live') {
        const results: any = {
            verificationFees: {},
            subscriptions: {},
            addons: {}
        };

        const ensureObject = (val: any) => {
            if (typeof val === 'object' && val !== null) return { ...val };
            return { max: Number(val) || 0 };
        };

        const tasks: (() => Promise<void>)[] = [];

        // 1. Verification Fees
        for (const [role, rawRegions] of Object.entries((config.verificationFees || {}) as any)) {
            const regions = rawRegions as any;
            const india = ensureObject(regions.india);
            const global = ensureObject(regions.global);
            
            results.verificationFees[role] = { ...regions, india, global };

            tasks.push(async () => {
                const indiaPricePaise = (Number(india.price_inr) || (Number(india.max) * 100) || 0);
                const globalPriceCents = (Number(global.price_usd) || (Number(global.max) * 100) || 0);
                const existingProductId = regions.stripeProductId || india.stripeProductId || global.stripeProductId;

                const res = await this.syncStripeProduct({
                    type: 'ONE_TIME', role, tier: 'verification',
                    indiaPricePaise, 
                    globalPriceCents,
                    name: `LVC - ${role} Verification`,
                    stripeProductId: existingProductId,
                    stripePriceId_inr: india.stripePriceId_inr || regions.stripePriceId_inr,
                    stripePriceId_usd: global.stripePriceId_usd || regions.stripePriceId_usd
                }, stripeMode, { skipFirestoreUpdate: true });

                results.verificationFees[role].stripeProductId = res.stripeProductId;
                results.verificationFees[role].stripePriceId_inr = res.stripePriceId_inr;
                results.verificationFees[role].stripePriceId_usd = res.stripePriceId_usd;

                results.verificationFees[role].india = {
                    ...india,
                    stripeProductId: res.stripeProductId,
                    stripePriceId_inr: res.stripePriceId_inr
                };
                results.verificationFees[role].global = {
                    ...global,
                    stripeProductId: res.stripeProductId,
                    stripePriceId_usd: res.stripePriceId_usd
                };
            });
        }

        // 2. Subscriptions
        for (const [category, rawTiers] of Object.entries((config.subscriptions || {}) as any)) {
            if (category === 'showUpgradeButton') continue;
            const categoryConfig = rawTiers as any;
            results.subscriptions[category] = {
                showUpgradeButton: categoryConfig.showUpgradeButton ?? false
            };
            
            for (const [tier, tierData] of Object.entries((categoryConfig || {}) as any)) {
                if (tier === 'showUpgradeButton') continue;
                const data = tierData as any;
                const india = ensureObject(data.india);
                const global = ensureObject(data.global);
                
                results.subscriptions[category][tier] = { ...data, india, global };

                tasks.push(async () => {
                    const indiaPricePaise = (Number(india.price_inr) || (Number(india.max) * 100) || 0);
                    const globalPriceCents = (Number(global.price_usd) || (Number(global.max) * 100) || 0);
                    const existingProductId = data.stripeProductId || india.stripeProductId || global.stripeProductId;

                    const res = await this.syncStripeProduct({
                        type: 'SUBSCRIPTION', role: category, tier,
                        indiaPricePaise, 
                        globalPriceCents,
                        name: `LVC - ${category} ${tier} Subscription`,
                        stripeProductId: existingProductId,
                        stripePriceId_inr: india.stripePriceId_inr || data.stripePriceId_inr,
                        stripePriceId_usd: global.stripePriceId_usd || data.stripePriceId_usd
                    }, stripeMode, { skipFirestoreUpdate: true });

                    results.subscriptions[category][tier].stripeProductId = res.stripeProductId;
                    results.subscriptions[category][tier].stripePriceId_inr = res.stripePriceId_inr;
                    results.subscriptions[category][tier].stripePriceId_usd = res.stripePriceId_usd;

                    results.subscriptions[category][tier].india = {
                        ...india,
                        stripeProductId: res.stripeProductId,
                        stripePriceId_inr: res.stripePriceId_inr
                    };
                    results.subscriptions[category][tier].global = {
                        ...global,
                        stripeProductId: res.stripeProductId,
                        stripePriceId_usd: res.stripePriceId_usd
                    };
                });
            }
        }

        // 3. Addons
        for (const [addonKey, addonData] of Object.entries((config.addons || {}) as any)) {
            const data = addonData as any;
            const india = ensureObject(data.india);
            const global = ensureObject(data.global);
            
            results.addons[addonKey] = { ...data, india, global };

            tasks.push(async () => {
                const indiaPricePaise = (Number(india.price_inr) || (Number(india.max) * 100) || 0);
                const globalPriceCents = (Number(global.price_usd) || (Number(global.max) * 100) || 0);
                const existingProductId = data.stripeProductId || india.stripeProductId || global.stripeProductId;

                const res = await this.syncStripeProduct({
                    type: 'ONE_TIME', role: 'addon', tier: addonKey,
                    indiaPricePaise, 
                    globalPriceCents,
                    name: `LVC - ${addonKey} Addon`,
                    stripeProductId: existingProductId,
                    stripePriceId_inr: india.stripePriceId_inr || data.stripePriceId_inr,
                    stripePriceId_usd: global.stripePriceId_usd || data.stripePriceId_usd
                }, stripeMode, { skipFirestoreUpdate: true });

                results.addons[addonKey].stripeProductId = res.stripeProductId;
                results.addons[addonKey].stripePriceId_inr = res.stripePriceId_inr;
                results.addons[addonKey].stripePriceId_usd = res.stripePriceId_usd;

                results.addons[addonKey].india = {
                    ...india,
                    stripeProductId: res.stripeProductId,
                    stripePriceId_inr: res.stripePriceId_inr
                };
                results.addons[addonKey].global = {
                    ...global,
                    stripeProductId: res.stripeProductId,
                    stripePriceId_usd: res.stripePriceId_usd
                };
            });
        }

        for (const task of tasks) {
            await this.withRetry(task);
            await new Promise(res => setTimeout(res, 150));
        }

        // Fetch existing Firestore config to preserve trialDays values (set via admin UI, not part of sync payload)
        const existingDoc = await db.collection('configurations').doc('pricing').get();
        const existingData = existingDoc.data() || {};

        // Merge trialDays back into subscription tiers so sync doesn't wipe them
        for (const [category, tiers] of Object.entries(results.subscriptions as any)) {
            for (const [tier, tierData] of Object.entries(tiers as any)) {
                if (tier === 'showUpgradeButton') continue;
                const existingTrialDays = existingData?.subscriptions?.[category]?.[tier]?.trialDays;
                if (existingTrialDays !== undefined) {
                    (results.subscriptions as any)[category][tier].trialDays = existingTrialDays;
                }
            }
        }

        // Update Firestore one last time with the total config
        await db.collection('configurations').doc('pricing').set({
            ...results,
            updatedAt: new Date().toISOString()
        }, { merge: true });

        return results;
    }

    /**
     * Update the trial days for a specific subscription role+tier.
     * trialDays = 0 means no trial period.
     */
    async updateTrialDays(role: string, tier: string, trialDays: number) {
        const field = `subscriptions.${role}.${tier}.trialDays`;
        await db.collection('configurations').doc('pricing').update({
            [field]: trialDays,
        });

        logger.info(`[AdminPricingService] Updated trialDays for ${role}.${tier} → ${trialDays}`);

        return {
            role,
            tier,
            trialDays,
            message: trialDays === 0
                ? `Trial period removed for ${role} / ${tier}`
                : `Trial period set to ${trialDays} days for ${role} / ${tier}`,
        };
    }

    private async withRetry<T>(fn: () => Promise<T>, retries = 3, delayMs = 1000): Promise<T> {
        try {
            return await fn();
        } catch (err: any) {
            const isRateLimit = err?.statusCode === 429 || err?.status === 429 || err?.type === 'StripeRateLimitError' || err?.message?.includes('Rate limit') || err?.message?.includes('rate limit');
            if (retries > 0 && isRateLimit) {
                console.warn(`[WARN] Stripe Rate limit hit. Retrying in ${delayMs}ms...`);
                await new Promise(res => setTimeout(res, delayMs));
                return this.withRetry(fn, retries - 1, delayMs * 2);
            }
            throw err;
        }
    }
}
