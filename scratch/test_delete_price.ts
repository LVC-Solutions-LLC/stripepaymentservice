import Stripe from 'stripe';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.dev' });

const secretKey = process.env.STRIPE_TEST_SECRET_KEY;
if (!secretKey) {
    console.error("No test secret key found!");
    process.exit(1);
}

const stripe = new Stripe(secretKey, { apiVersion: '2023-10-16' as any });

async function testDelete() {
    console.log("Listing 1 archived product...");
    const list = await stripe.products.list({ limit: 1, active: false });
    if (list.data.length === 0) {
        console.log("No archived products found.");
        return;
    }

    const prod = list.data[0];
    console.log(`Product: ${prod.name} (${prod.id})`);

    // List all prices (both active and inactive) for this product
    const prices = await stripe.prices.list({ product: prod.id, limit: 100 });
    console.log(`Found ${prices.data.length} prices for product ${prod.id}`);

    for (const price of prices.data) {
        try {
            // Attempt to delete price
            await (stripe.prices as any).del(price.id);
            console.log(`  - Deleted price: ${price.id}`);
        } catch (err: any) {
            console.log(`  - Failed to delete price ${price.id}: ${err.message}`);
        }
    }

    // Now attempt to delete product
    try {
        await stripe.products.del(prod.id);
        console.log(`✅ Successfully deleted product: ${prod.id}`);
    } catch (err: any) {
        console.error(`❌ Failed to delete product ${prod.id}: ${err.message}`);
    }
}

testDelete();
