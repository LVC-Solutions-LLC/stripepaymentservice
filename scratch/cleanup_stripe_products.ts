import Stripe from 'stripe';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.dev' });

const mode = (process.argv[2] as 'test' | 'live') || 'test';
const secretKey = mode === 'live' ? process.env.STRIPE_LIVE_SECRET_KEY : process.env.STRIPE_TEST_SECRET_KEY;

if (!secretKey) {
    console.error(`❌ Secret key for mode '${mode}' is missing in .env.dev`);
    process.exit(1);
}

const stripe = new Stripe(secretKey, { apiVersion: '2023-10-16' as any });

async function cleanupStripeProducts() {
    console.log(`🚀 Starting cleanup for all active products starting with 'LVC -' in ${mode.toUpperCase()} mode...`);

    let hasMore = true;
    let startingAfter: string | undefined = undefined;
    let count = 0;
    let archivedCount = 0;

    while (hasMore) {
        const responseList: Stripe.ApiList<Stripe.Product> = await stripe.products.list({
            limit: 100,
            active: true,
            starting_after: startingAfter,
        });

        if (responseList.data.length === 0) {
            break;
        }

        for (const product of responseList.data) {
            if (product.name.startsWith('LVC -')) {
                count++;
                try {
                    // 1. Deactivate associated active prices
                    const prices = await stripe.prices.list({ product: product.id, active: true, limit: 100 });
                    for (const price of prices.data) {
                        await stripe.prices.update(price.id, { active: false }).catch(() => {});
                    }

                    // 2. Try deleting product outright, or archive if deleting is blocked by Stripe
                    try {
                        await stripe.products.del(product.id);
                        console.log(`[${count}] 🗑️  Deleted product: ${product.name} (${product.id})`);
                    } catch (e) {
                        await stripe.products.update(product.id, { active: false });
                        console.log(`[${count}] 📦 Archived product: ${product.name} (${product.id})`);
                    }
                    archivedCount++;
                } catch (err: any) {
                    console.error(`❌ Error cleaning product ${product.name} (${product.id}):`, err.message);
                }
            }
        }

        hasMore = responseList.has_more;
        if (responseList.data.length > 0) {
            startingAfter = responseList.data[responseList.data.length - 1].id;
        }
    }

    console.log(`\n✅ Finished cleanup! Processed ${archivedCount} 'LVC -' products in ${mode.toUpperCase()} mode.`);
}

cleanupStripeProducts();
