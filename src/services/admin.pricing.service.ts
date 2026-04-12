import { getStripe } from '../config/stripe';
import { db } from '../config/db';
import { AppError } from '../utils/AppError';

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
    }, stripeMode?: 'test' | 'live') {
        const stripe = getStripe(stripeMode);
        let { type, role, tier, stripeProductId, stripePriceId_inr, stripePriceId_usd, indiaPricePaise, globalPriceCents, name, description } = payload;

        // 1. Resolve or Create Product
        if (!stripeProductId) {
            const product = await stripe.products.create({
                name: name,
                description: description || `Pricing tier for ${role} ${tier || ''}`,
                metadata: { type, role, tier: tier || '' }
            });
            stripeProductId = product.id;
        } else {
            // Update existing
            await stripe.products.update(stripeProductId, {
                name: name,
                description: description || `Pricing tier for ${role} ${tier || ''}`,
            });
        }

        // 2. Sync Prices (create new if amount changed)
        const syncPrice = async (amount: number, currency: string, existingPriceId?: string | null) => {
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
                    unit_amount: amount,
                    currency: currency.toLowerCase(),
                    recurring: type === 'SUBSCRIPTION' ? { interval: 'month' } : undefined,
                });
                return newPrice.id;
            }
            return existingPriceId;
        };

        const newPriceIdInr = await syncPrice(indiaPricePaise, 'INR', stripePriceId_inr);
        const newPriceIdUsd = await syncPrice(globalPriceCents, 'USD', stripePriceId_usd);

        // 3. Update Firestore back with new Price IDs if they changed
        const updateData: any = {};
        if (role === 'addon' && tier) {
            updateData[`addons.${tier}.stripeProductId`] = stripeProductId;
            updateData[`addons.${tier}.stripePriceId_inr`] = newPriceIdInr;
            updateData[`addons.${tier}.stripePriceId_usd`] = newPriceIdUsd;
        } else if (type === 'ONE_TIME') {
            updateData[`oneTime.${role}.stripeProductId`] = stripeProductId;
            updateData[`oneTime.${role}.stripePriceId_inr`] = newPriceIdInr;
            updateData[`oneTime.${role}.stripePriceId_usd`] = newPriceIdUsd;
        } else if (tier) {
            updateData[`subscriptions.${role}.${tier}.stripeProductId`] = stripeProductId;
            updateData[`subscriptions.${role}.${tier}.stripePriceId_inr`] = newPriceIdInr;
            updateData[`subscriptions.${role}.${tier}.stripePriceId_usd`] = newPriceIdUsd;
        }

        await db.collection('configurations').doc('pricing').update(updateData);

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

        // 1. Verification Fees
        for (const [role, rawRegions] of Object.entries((config.verificationFees || {}) as any)) {
            const regions = rawRegions as any;
            const india = ensureObject(regions.india);
            const global = ensureObject(regions.global);
            
            results.verificationFees[role] = { india, global };
            
            // India
            const indiaPricePaise = (Number(india.price_inr) || (Number(india.max) * 100) || 0);
            if (indiaPricePaise > 0) {
                const res = await this.syncStripeProduct({
                    type: 'ONE_TIME', role, tier: 'verification_india',
                    indiaPricePaise, 
                    globalPriceCents: (Number(global.price_usd) || (Number(global.max) * 100) || 0),
                    name: `LVC - ${role} Verification (India)`,
                    stripeProductId: india.stripeProductId,
                    stripePriceId_inr: india.stripePriceId_inr
                }, stripeMode);
                results.verificationFees[role].india = {
                    ...india,
                    stripeProductId: res.stripeProductId,
                    stripePriceId_inr: res.stripePriceId_inr
                };
            }
            // Global
            const globalPriceCents = (Number(global.price_usd) || (Number(global.max) * 100) || 0);
            if (globalPriceCents > 0) {
                const res = await this.syncStripeProduct({
                    type: 'ONE_TIME', role, tier: 'verification_global',
                    indiaPricePaise: (Number(india.price_inr) || (Number(india.max) * 100) || 0), 
                    globalPriceCents,
                    name: `LVC - ${role} Verification (Global)`,
                    stripeProductId: global.stripeProductId,
                    stripePriceId_usd: global.stripePriceId_usd
                }, stripeMode);
                results.verificationFees[role].global = {
                    ...global,
                    stripeProductId: res.stripeProductId,
                    stripePriceId_usd: res.stripePriceId_usd
                };
            }
        }

        // 2. Subscriptions
        for (const [category, rawTiers] of Object.entries((config.subscriptions || {}) as any)) {
            if (category === 'showUpgradeButton') continue;
            const categoryConfig = rawTiers as any;
            results.subscriptions[category] = {
                showUpgradeButton: categoryConfig.showUpgradeButton
            };
            
            for (const [tier, tierData] of Object.entries((categoryConfig || {}) as any)) {
                if (tier === 'showUpgradeButton') continue;
                const data = tierData as any;
                const india = ensureObject(data.india);
                const global = ensureObject(data.global);
                
                results.subscriptions[category][tier] = { ...data, india, global };

                // India
                const indiaPricePaise = (Number(india.price_inr) || (Number(india.max) * 100) || 0);
                if (indiaPricePaise > 0) {
                    const res = await this.syncStripeProduct({
                        type: 'SUBSCRIPTION', role: category, tier,
                        indiaPricePaise, 
                        globalPriceCents: (Number(global.price_usd) || (Number(global.max) * 100) || 0),
                        name: `LVC - ${category} ${tier} Subscription (India)`,
                        stripeProductId: india.stripeProductId,
                        stripePriceId_inr: india.stripePriceId_inr
                    }, stripeMode);
                    results.subscriptions[category][tier].india = {
                        ...india,
                        stripeProductId: res.stripeProductId,
                        stripePriceId_inr: res.stripePriceId_inr
                    };
                }
                // Global
                const globalPriceCents = (Number(global.price_usd) || (Number(global.max) * 100) || 0);
                if (globalPriceCents > 0) {
                    const res = await this.syncStripeProduct({
                        type: 'SUBSCRIPTION', role: category, tier,
                        indiaPricePaise: (Number(india.price_inr) || (Number(india.max) * 100) || 0), 
                        globalPriceCents,
                        name: `LVC - ${category} ${tier} Subscription (Global)`,
                        stripeProductId: global.stripeProductId,
                        stripePriceId_usd: global.stripePriceId_usd
                    }, stripeMode);
                    results.subscriptions[category][tier].global = {
                        ...global,
                        stripeProductId: res.stripeProductId,
                        stripePriceId_usd: res.stripePriceId_usd
                    };
                }
            }
        }

        // 3. Addons
        for (const [addonKey, addonData] of Object.entries((config.addons || {}) as any)) {
            const data = addonData as any;
            const india = ensureObject(data.india);
            const global = ensureObject(data.global);
            
            results.addons[addonKey] = { ...data, india, global };

            // India
            const indiaPricePaise = (Number(india.price_inr) || (Number(india.max) * 100) || 0);
            if (indiaPricePaise > 0) {
                const res = await this.syncStripeProduct({
                    type: 'ONE_TIME', role: 'addon', tier: addonKey,
                    indiaPricePaise, 
                    globalPriceCents: (Number(global.price_usd) || (Number(global.max) * 100) || 0),
                    name: `LVC - ${addonKey} Addon (India)`,
                    stripeProductId: india.stripeProductId,
                    stripePriceId_inr: india.stripePriceId_inr
                }, stripeMode);
                results.addons[addonKey].india = {
                    ...india,
                    stripeProductId: res.stripeProductId,
                    stripePriceId_inr: res.stripePriceId_inr
                };
            }
            // Global
            const globalPriceCents = (Number(global.price_usd) || (Number(global.max) * 100) || 0);
            if (globalPriceCents > 0) {
                const res = await this.syncStripeProduct({
                    type: 'ONE_TIME', role: 'addon', tier: addonKey,
                    indiaPricePaise: (Number(india.price_inr) || (Number(india.max) * 100) || 0), 
                    globalPriceCents,
                    name: `LVC - ${addonKey} Addon (Global)`,
                    stripeProductId: global.stripeProductId,
                    stripePriceId_usd: global.stripePriceId_usd
                }, stripeMode);
                results.addons[addonKey].global = {
                    ...global,
                    stripeProductId: res.stripeProductId,
                    stripePriceId_usd: res.stripePriceId_usd
                };
            }
        }

        // Update Firestore one last time with the total config
        await db.collection('configurations').doc('pricing').set({
            ...results,
            updatedAt: new Date().toISOString()
        }, { merge: true });

        return results;
    }
}
