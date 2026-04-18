
import { Stripe } from 'stripe';
import * as dotenv from 'dotenv';

dotenv.config();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2023-10-16' as any,
});

async function testApplyPromo() {
    const promoCode = "SUM48";
    const priceId = "price_1TMHcsG7HDya9H68Yqo80XCk";

    try {
        // 1. Find the promo code ID
        const promoCodes = await stripe.promotionCodes.list({ code: promoCode, active: true });
        if (promoCodes.data.length === 0) {
            console.error(`❌ Promo code ${promoCode} not found.`);
            return;
        }
        const promoId = promoCodes.data[0].id;
        console.log(`Testing with promo ID: ${promoId}`);

        // 2. Try to create a session with this discount applied directly
        const session = await stripe.checkout.sessions.create({
            mode: 'payment',
            line_items: [{ price: priceId, quantity: 1 }],
            discounts: [{ promotion_code: promoId }],
            success_url: 'https://example.com/success',
            cancel_url: 'https://example.com/cancel',
        });

        console.log("✅ Success! Stripe accepted the promo code for this one-time purchase.");
        console.log("Session URL:", session.url);

    } catch (err: any) {
        console.error("❌ Stripe REJECTED the promo code for this session:");
        console.error(`Error Code: ${err.code}`);
        console.error(`Message: ${err.message}`);
    }
}

testApplyPromo();
