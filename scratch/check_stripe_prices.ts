
import { Stripe } from 'stripe';
import * as dotenv from 'dotenv';
import * as admin from 'firebase-admin';

dotenv.config();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2023-10-16' as any,
});

async function checkPrices() {
    console.log("Using Stripe Secret Key starting with:", process.env.STRIPE_SECRET_KEY!.substring(0, 15));
    
    const productId = "prod_UKpEfTTDpYHYJI";
    console.log("Checking prices for product:", productId);

    try {
        const prices = await stripe.prices.list({
            product: productId,
            active: true,
        });

        console.log(`Found ${prices.data.length} active prices:`);
        prices.data.forEach(p => {
            console.log(`- ID: ${p.id}, Amount: ${p.unit_amount}, Currency: ${p.currency}, Active: ${p.active}`);
        });

        const inactivePrices = await stripe.prices.list({
            product: productId,
            active: false,
            limit: 5
        });
        console.log(`Found ${inactivePrices.data.length} inactive prices (showing 5):`);
        inactivePrices.data.forEach(p => {
            console.log(`- ID: ${p.id}, Amount: ${p.unit_amount}, Currency: ${p.currency}, Active: ${p.active}`);
        });

    } catch (err: any) {
        console.error("Error retrieving prices from Stripe:", err.message);
    }
}

checkPrices();
