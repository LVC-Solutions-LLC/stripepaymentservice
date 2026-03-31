import { db } from '../src/config/db';
import { getStripe } from '../src/config/stripe';
import { env } from '../src/config/env';

const PRICING_SEED = {
    subscriptions: {
        'student_job_seeker': {
            'basic': {
                india: 0,
                global: 0,
                benefits: [
                    'Basic profile visibility',
                    'Apply to 5 student-specific jobs/month',
                    'Community access'
                ]
            },
            'standard': {
                india: 9900, // ₹99
                global: 500, // $5
                benefits: [
                    'Priority profile listing',
                    'Unlimited student job applications',
                    'Direct chat with student recruiters',
                    'Skill assessment badge'
                ]
            }
        },
        'job_seeker': {
            'basic': {
                india: 0,
                global: 0,
                benefits: [
                    'Standard profile visibility',
                    'Apply to 3 jobs/month',
                    'Job alerts'
                ]
            },
            'standard': {
                india: 49900, // ₹499
                global: 1000, // $10
                benefits: [
                    'Profile featured to recruiters',
                    'Unlimited job applications',
                    'AI Resume optimization prompts',
                    'Advanced job filters'
                ]
            },
            'premium': {
                india: 99900, // ₹999
                global: 2000, // $20
                benefits: [
                    'Premium profile badge',
                    'Direct messaging to companies',
                    'Salary insights for listing',
                    'Incognito mode browsing'
                ]
            }
        },
        'company': {
            '1_seat': {
                india: 499900, // ₹4,999
                global: 5900, // $59
                benefits: [
                    '1 Recruiter seat',
                    'Unlimited job postings',
                    'Active candidate search',
                    'Company overview page'
                ]
            },
            '5_seats': {
                india: 1999900, // ₹19,999
                global: 19900, // $199
                benefits: [
                    '5 Recruiter seats (Team sharing)',
                    'Priority job listings',
                    'Advanced candidate filtering',
                    'Analytics dashboard'
                ]
            }
        }
    },
    oneTime: {
        'student_job_seeker': {
            india: 19900, // ₹199
            global: 500, // $5
            benefits: ['One-time identity verification', 'Verified badge on profile']
        },
        'job_seeker': {
            india: 49900, // ₹499
            global: 1000, // $10
            benefits: ['One-time identity verification', 'Verified badge on profile', 'Fraud protection']
        },
        'recruiter': {
            india: 199900, // ₹1,999
            global: 4900, // $49
            benefits: ['Company verification', 'Recruiter identity proof', 'Trust score badge']
        },
        'company': {
            india: 499900, // ₹4,999
            global: 14900, // $149
            benefits: ['Business registration verification', 'Verified company badge', 'Corporate trust profile']
        }
    }
};

async function getOrCreatePrice(stripe: any, productId: string, amount: number, currency: string, recurring?: boolean) {
    if (amount === 0) return null;

    const prices = await stripe.prices.list({ product: productId, active: true });
    const existing = prices.data.find((p: any) => p.unit_amount === amount && p.currency === currency.toLowerCase());
    
    if (existing) {
        console.log(`  ✅ Price exists: ${existing.id} (${amount} ${currency})`);
        return existing.id;
    }

    console.log(`  ➕ Creating Price: ${amount} ${currency}`);
    const priceData: any = {
        unit_amount: amount,
        currency: currency.toLowerCase(),
        product: productId,
    };

    if (recurring) {
        priceData.recurring = { interval: 'month' };
    }

    const price = await stripe.prices.create(priceData);
    return price.id;
}

async function seedPricing() {
    const stripe = getStripe(env.STRIPE_MODE);
    console.log(`🚀 Starting pricing seed in ${env.STRIPE_MODE} mode...`);

    const finalConfig = JSON.parse(JSON.stringify(PRICING_SEED));

    // 1. Process Subscriptions
    for (const [role, plans] of Object.entries(PRICING_SEED.subscriptions)) {
        for (const [planId, data] of Object.entries(plans)) {
            const productName = `LVC Fair Job: ${role.replace(/_/g, ' ').toUpperCase()} ${planId.toUpperCase()} Subscription`;
            
            console.log(`📦 Subscription: ${productName}`);
            
            const products = await stripe.products.list({ limit: 100, active: true });
            let product = products.data.find(p => p.name === productName);
            
            if (!product) {
                console.log(`  ➕ Creating Product`);
                product = await stripe.products.create({
                    name: productName,
                    description: `Subscription plan for ${role.replace(/_/g, ' ')}`,
                    metadata: { type: 'SUBSCRIPTION', role, planId }
                });
            }

            const priceInr = await getOrCreatePrice(stripe, product.id, (data as any).india, 'inr', true);
            const priceUsd = await getOrCreatePrice(stripe, product.id, (data as any).global, 'usd', true);

            const planConfig = (finalConfig.subscriptions as any)[role][planId];
            planConfig.stripeProductId = product.id;
            if (priceInr) planConfig.stripePriceId_inr = priceInr;
            if (priceUsd) planConfig.stripePriceId_usd = priceUsd;
        }
    }

    // 2. Process One-Time Fees
    for (const [role, data] of Object.entries(PRICING_SEED.oneTime)) {
        const productName = `LVC Fair Job: ${role.replace(/_/g, ' ').toUpperCase()} Identity Verification`;
        
        console.log(`📦 One-Time: ${productName}`);
        
        const products = await stripe.products.list({ limit: 100, active: true });
        let product = products.data.find(p => p.name === productName);
        
        if (!product) {
            console.log(`  ➕ Creating Product`);
            product = await stripe.products.create({
                name: productName,
                description: `One-time identity verification fee for ${role.replace(/_/g, ' ')}`,
                metadata: { type: 'ONE_TIME', role }
            });
        }

        const priceInr = await getOrCreatePrice(stripe, product.id, (data as any).india, 'inr', false);
        const priceUsd = await getOrCreatePrice(stripe, product.id, (data as any).global, 'usd', false);

        const feeConfig = (finalConfig.oneTime as any)[role];
        feeConfig.stripeProductId = product.id;
        if (priceInr) feeConfig.stripePriceId_inr = priceInr;
        if (priceUsd) feeConfig.stripePriceId_usd = priceUsd;
    }

    // 3. Store in Firestore
    console.log('💾 Storing configuration in Firestore...');
    await db.collection('configurations').doc('pricing').set({
        ...finalConfig,
        updatedAt: new Date().toISOString()
    });

    console.log('✨ Pricing seed completed successfully!');
    process.exit(0);
}

seedPricing().catch(err => {
    console.error('❌ Error seeding pricing:', err);
    process.exit(1);
});
