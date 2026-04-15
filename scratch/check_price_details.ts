
import { Stripe } from 'stripe';
import * as dotenv from 'dotenv';

dotenv.config();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2023-10-16' as any,
});

async function checkPrice() {
    const priceId = process.argv[2] || "price_1TMHcsG7HDya9H68Yqo80XCk";
    console.log(`Checking price: ${priceId}`);

    try {
        const price = await stripe.prices.retrieve(priceId);
        console.log("✅ Price Data:");
        console.log(JSON.stringify(price, null, 2));

        if (price.product) {
            const product = await stripe.products.retrieve(price.product as string);
            console.log("✅ Product Data:");
            console.log(JSON.stringify(product, null, 2));
        }

    } catch (err: any) {
        console.error("Error retrieving data from Stripe:", err.message);
    }
}

checkPrice();
