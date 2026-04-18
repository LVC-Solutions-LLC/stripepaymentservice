
import { Stripe } from 'stripe';
import * as dotenv from 'dotenv';

dotenv.config();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2023-10-16' as any,
});

async function inspectCoupon() {
    const couponId = "lbHDagm0";
    console.log(`Inspecting coupon: ${couponId}`);

    try {
        const coupon = await stripe.coupons.retrieve(couponId);
        console.log("✅ Coupon Data:");
        console.log(JSON.stringify(coupon, null, 2));

        if (coupon.applies_to && coupon.applies_to.products) {
            console.log("Restriction detected. Products allowed:");
            for (const pid of coupon.applies_to.products) {
                const prod = await stripe.products.retrieve(pid);
                console.log(`- ${pid} (${prod.name})`);
            }
        } else {
            console.log("No product restrictions found on the coupon itself.");
        }

    } catch (err: any) {
        console.error("Error retrieving data from Stripe:", err.message);
    }
}

inspectCoupon();
