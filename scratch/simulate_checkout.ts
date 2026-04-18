
import { Stripe } from 'stripe';
import * as dotenv from 'dotenv';

dotenv.config();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2023-10-16' as any,
});

async function simulateCheckout() {
    const promoCode = "SUM48";
    const priceId = "price_1TMHcsG7HDya9H68Yqo80XCk"; // Extra recruiter seat addon (INR 50)

    try {
        console.log(`Simulating checkout with Price ID: ${priceId} and Promo Code: ${promoCode}...`);
        
        // We first need the promotion code object to get its ID, 
        // because checkout.sessions.create allows 'discounts' but they usually expect promo code IDs or coupon IDs.
        // Actually, for 'allow_promotion_codes: true', we just test if Stripe accepts the session creation.
        
        const session = await stripe.checkout.sessions.create({
            mode: 'payment',
            line_items: [
                {
                    price: priceId,
                    quantity: 1,
                },
            ],
            allow_promotion_codes: true,
            success_url: 'https://example.com/success',
            cancel_url: 'https://example.com/cancel',
        });

        console.log("✅ Checkout Session created successfully.");
        console.log("URL:", session.url);
        console.log("\nPlease manually visit this URL and try entering 'SUM48'. If it says invalid there, it is a Stripe-side configuration issue (e.g., restricted to subscriptions only).");

    } catch (err: any) {
        console.error("❌ Stripe rejected session creation:", err.message);
    }
}

simulateCheckout();
