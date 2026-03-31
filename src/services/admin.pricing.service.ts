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
        if (type === 'ONE_TIME') {
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
}
