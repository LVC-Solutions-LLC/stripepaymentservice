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

const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

async function deleteArchivedProducts() {
    console.log(`🚀 Scanning for all archived (active: false) products in Stripe [${mode.toUpperCase()} mode]...\n`);

    let hasMore = true;
    let startingAfter: string | undefined = undefined;
    let totalArchivedFound = 0;
    let deletedCount = 0;
    let skippedCount = 0;

    while (hasMore) {
        let responseList: Stripe.ApiList<Stripe.Product>;
        try {
            responseList = await stripe.products.list({
                limit: 100,
                active: false, // Fetch archived products
                starting_after: startingAfter,
            });
        } catch (err: any) {
            console.error(`❌ Error listing products:`, err.message);
            break;
        }

        if (responseList.data.length === 0) {
            break;
        }

        for (const product of responseList.data) {
            totalArchivedFound++;
            try {
                // Attempt to delete product
                await stripe.products.del(product.id);
                deletedCount++;
                console.log(`[${totalArchivedFound}] 🗑️  DELETED: ${product.name} (${product.id})`);
            } catch (err: any) {
                skippedCount++;
                console.warn(`[${totalArchivedFound}] ⚠️  SKIPPED (${product.name} - ${product.id}): ${err.message}`);
            }

            // Small delay to prevent hitting Stripe rate limits
            await delay(100);
        }

        hasMore = responseList.has_more;
        if (responseList.data.length > 0) {
            startingAfter = responseList.data[responseList.data.length - 1].id;
        }
    }

    console.log(`\n==================================================`);
    console.log(`✅ Finished Scan!`);
    console.log(`📦 Total Archived Products Found: ${totalArchivedFound}`);
    console.log(`🗑️  Successfully Deleted: ${deletedCount}`);
    console.log(`⚠️  Skipped (Stripe blocked due to attached prices/invoices): ${skippedCount}`);
    console.log(`==================================================\n`);
}

deleteArchivedProducts();
