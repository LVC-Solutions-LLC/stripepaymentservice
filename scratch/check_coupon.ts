
import { Stripe } from 'stripe';
import * as dotenv from 'dotenv';

dotenv.config();

async function checkCoupon(mode: 'test' | 'live') {
    console.log(`\n--- Checking ${mode.toUpperCase()} mode ---`);
    const key = mode === 'live' ? process.env.STRIPE_SECRET_KEY : (process.env.STRIPE_TEST_SECRET_KEY || process.env.STRIPE_SECRET_KEY);
    
    if (!key) {
        console.log(`No key found for ${mode}`);
        return;
    }

    const stripe = new Stripe(key, { apiVersion: '2023-10-16' as any });
    const codeToSearch = "SUM48";

    try {
        const promoCodes = await stripe.promotionCodes.list({ limit: 100, active: true });
        const exactPromo = promoCodes.data.find(p => p.code.toUpperCase() === codeToSearch.toUpperCase());
        
        if (exactPromo) {
            console.log(`✅ Found Promotion Code in ${mode}:`);
            console.log(`ID: ${exactPromo.id}, Active: ${exactPromo.active}, Coupon ID: ${exactPromo.coupon.id}`);
            console.log(`Currency: ${exactPromo.coupon.currency}, Amount Off: ${exactPromo.coupon.amount_off}`);
            return true;
        }

        const coupons = await stripe.coupons.list({ limit: 100 });
        const exactCoupon = coupons.data.find(c => c.id.toUpperCase() === codeToSearch.toUpperCase() || c.name?.toUpperCase() === codeToSearch.toUpperCase());
        if (exactCoupon) {
            console.log(`⚠️ Found Coupon ID/Name "${codeToSearch}" in ${mode}, but NO active Promotion Code.`);
            console.log(`Coupon ID: ${exactCoupon.id}, Valid: ${exactCoupon.valid}`);
            return true;
        }

        console.log(`❌ No code "${codeToSearch}" found in ${mode}.`);
        return false;
    } catch (err: any) {
        console.error(`Error in ${mode}: ${err.message}`);
        return false;
    }
}

async function main() {
    await checkCoupon('test');
    await checkCoupon('live');
}

main();
