import Stripe from 'stripe';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.dev' });

const secretKey = process.env.STRIPE_TEST_SECRET_KEY;
if (!secretKey) {
    console.error("No test secret key found!");
    process.exit(1);
}

const stripe = new Stripe(secretKey, { apiVersion: '2023-10-16' as any });

async function checkArchived() {
    const list = await stripe.products.list({ limit: 100, active: false });
    console.log(`Currently archived products count in page 1: ${list.data.length}`);
    for (const p of list.data.slice(0, 10)) {
        console.log(` - ID: ${p.id}, Name: ${p.name}`);
        try {
            const delRes = await stripe.products.del(p.id);
            console.log(`   --> SUCCESS DELETED: ${delRes.id}`);
        } catch (e: any) {
            console.log(`   --> FAILED: ${e.message}`);
        }
    }
}

checkArchived();
