import { db } from '../src/config/db';
import { getStripe } from '../src/config/stripe';
import { env } from '../src/config/env';

const PRICING_SEED = {
    subscriptions: {
        'student_job_seeker': {
            'basic': {
                india: 39900,
                global: 900,
                benefits: [
                    'Standard profile visibility',
                    'Apply to verified jobs (limited)',
                    'Basic messaging'
                ]
            },
            'standard': {
                india: 99900, // ₹999
                global: 1900, // $19
                benefits: [
                    'Priority profile listing',
                    'Unlimited student job applications',
                    '2 AI mock interviews/month',
                    'Shortlist-ready profile score'
                ]
            }
        },
        'job_seeker': {
            'basic': {
                india: 39900, // ₹399
                global: 900, // $9
                benefits: [
                    'Verified badge shown on profile',
                    'Apply to verified jobs (limited)',
                    '1 resume fix & 1 screening/month',
                    'Basic messaging'
                ]
            },
            'standard': {
                india: 99900, // ₹999
                global: 1900, // $19
                benefits: [
                    'Higher application + messaging limits',
                    '2 resume optimizations/month',
                    '2 AI mock interviews/month',
                    'Shortlist-ready profile score'
                ]
            },
            'premium': {
                india: 249900, // ₹2,499
                global: 4900, // $49
                benefits: [
                    'Priority screening queue + fast-track badge',
                    'Unlimited interview practice (AI)',
                    'Profile boost in recruiter searches',
                    'Early access to hot jobs'
                ]
            }
        },
        'company': {
            '1_seat': {
                india: 1650000,   // ~₹16,500
                global: 19900,    // $199
                seats: 1,
                maxActiveJobs: 3,
                benefits: [
                    '1 Recruiter Seat',
                    'Post 3 Active Jobs',
                    'Access Verified Candidates',
                    'Basic ATS + Pipeline'
                ]
            },
            '2_seats': {
                india: 2890000,   // ~₹28,900
                global: 34900,    // $349
                seats: 2,
                maxActiveJobs: 7,
                benefits: [
                    '2 Recruiter Seats',
                    'Post 7 Active Jobs',
                    'More Outreach Credits',
                    'Shared Pipeline + Team notes'
                ]
            },
            '5_seats': {
                india: 4990000,   // ~₹49,900
                global: 59900,    // $599
                seats: 5,
                maxActiveJobs: 15,
                benefits: [
                    '5 Recruiter Seats',
                    'Post 15 Active Jobs',
                    'Higher Outreach Credits',
                    'Basic API Export'
                ]
            },
            '10_seats': {
                india: 12400000,  // ~₹1,24,000
                global: 149900,   // $1,499
                seats: 10,
                maxActiveJobs: 30,
                benefits: [
                    '10 Recruiter Seats',
                    'Post 30 Active Jobs',
                    'Team Analytics Dashboard',
                    'Candidate Shortlist Export'
                ]
            },
            '25_seats': {
                india: 33000000,  // ~₹3,30,000
                global: 399900,   // $3,999
                seats: 25,
                maxActiveJobs: 100,
                benefits: [
                    '25 Recruiter Seats',
                    'Post 100 Active Jobs',
                    'Role-based Permissions (RBAC)',
                    'Advanced Analytics + SLAs'
                ]
            },
            'enterprise': {
                india: 60000000,  // ~₹6,00,000
                global: 750000,   // $7,500
                seats: 999,
                maxActiveJobs: 999,
                benefits: [
                    'Unlimited Seats',
                    'SSO (SAML)',
                    'Custom Workflows',
                    'Dedicated Success Manager'
                ]
            }
        },
        'sales_champion': {
            'starter': {
                india: 240000, // ~₹2,400
                global: 2900, // $29
                benefits: ['Verified badge', 'Lead submission portal', 'Basic performance dashboard']
            },
            'pro': {
                india: 650000, // ~₹6,500
                global: 7900, // $79
                benefits: ['CRM-lite', 'Higher lead limits', 'Sales scripts + pitch templates']
            },
            'elite': {
                india: 1200000, // ~₹12,000
                global: 14900, // $149
                benefits: ['Territory-based leads', 'Dedicated review priority', 'Commission accelerator (+2-3%)']
            },
            'partner': {
                india: 2400000, // ~₹24,000
                global: 29900, // $299
                benefits: ['Priority leads + assignment', 'Higher commission tier (+5%)', 'Contract automation']
            }
        },
        'layoff_mode': {
            'lite': {
                india: 75000, 
                global: 1500,
                benefits: ['Layoff badge', 'Fast-track resume fix', 'Priority job matches']
            },
            'plus': {
                india: 200000,
                global: 3900,
                benefits: ['Everything in Lite', '2 screening fast-tracks/month', '2 mock interviews/month']
            },
            'max': {
                india: 400000,
                global: 7900,
                benefits: ['Everything in Plus', '4 fast-tracks/month', 'Hot job alerts + first look']
            }
        }
    },
    oneTime: {
        'student_job_seeker': {
            india: 19900, // ₹199
            global: 500, // $5
            benefits: ['Identity KYC', 'University trust check', 'Verified student badge']
        },
        'job_seeker': {
            india: 49900, // ₹499
            global: 1000, // $10
            benefits: ['Identity KYC', 'Face match & liveness', 'Fraud & risk checks', 'Lifetime Verified badge']
        },
        'recruiter': {
            india: 199900, // ₹1,999
            global: 4900, // $49
            benefits: ['Personal KYC', 'Recruiter identity proof', 'Trust score badge']
        },
        'company': {
            india: 499900, // ₹4,999
            global: 14900, // $149
            benefits: ['Registry checks', 'Domain verification', 'Manual review', 'Verified company badge']
        },
        'university': {
            india: 999900, // ₹9,999
            global: 29900, // $299
            benefits: ['Institutional verification', 'Admin overhead coverage', 'Brand trust benefits']
        },
        'sales_champion': {
            india: 299900, // ₹2,999
            global: 7900, // $79
            benefits: ['Financial & reputation risk', 'Contract signing approval', 'Manual approval processing']
        }
    },
    addons: {
        'employment_verification': {
            india: 199900, // ₹1,999
            global: 4900,  // $49
            benefits: ['Truework/Work Number verification', 'Dedicated employment history badge']
        },
        'profile_boost': {
            india: 39900, // ₹399
            global: 1000, // $10
            benefits: ['Top of search results for 7 days', 'Highlighted profile badge']
        },
        'extra_screening_pack': {
            india: 99900, // ₹999
            global: 2500, // $25
            benefits: ['Additional recruiter screening', 'Expedited approval options']
        },
        'extra_recruiter_seat': {
            india: 410000, // ~$49
            global: 4900,  // $49 / extra
            benefits: ['1 extra recruiter seat', 'Shared team pipeline']
        },
        'extra_job_posting': {
            india: 820000, // ~$99
            global: 9900,  // $99 / extra
            benefits: ['Post 1 additional job', 'Valid actively for 30 days']
        },
        'guaranteed_shortlist': {
            india: 4150000, // ~$500
            global: 50000,  // $500
            benefits: ['Guaranteed shortlist delivery', 'Premium recruitment promise']
        }
    }
};

async function getOrCreatePrice(stripe: any, productId: string, amount: number, currency: string, recurring?: boolean) {
    if (amount === 0) return null;

    const prices = await stripe.prices.list({ product: productId, active: true });
    const existing = prices.data.find((p: any) => {
        const isSameAmount = p.unit_amount === amount && p.currency === currency.toLowerCase();
        const isSameType = recurring ? p.type === 'recurring' : p.type === 'one_time';
        return isSameAmount && isSameType;
    });
    
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

    // 3. Process Addons
    for (const [addonId, data] of Object.entries(PRICING_SEED.addons)) {
        const productName = `LVC Fair Job ADDON: ${addonId.replace(/_/g, ' ').toUpperCase()}`;
        console.log(`📦 Addon: ${productName}`);

        const products = await stripe.products.list({ limit: 100, active: true });
        let product = products.data.find(p => p.name === productName);

        if (!product) {
            console.log(`  ➕ Creating Product`);
            product = await stripe.products.create({
                name: productName,
                description: `One-time addon: ${addonId.replace(/_/g, ' ')}`,
                metadata: { type: 'ONE_TIME_ADDON', addonId }
            });
        }

        const priceInr = await getOrCreatePrice(stripe, product.id, (data as any).india, 'inr', false);
        const priceUsd = await getOrCreatePrice(stripe, product.id, (data as any).global, 'usd', false);

        const addonConfig = (finalConfig.addons as any)[addonId];
        addonConfig.stripeProductId = product.id;
        if (priceInr) addonConfig.stripePriceId_inr = priceInr;
        if (priceUsd) addonConfig.stripePriceId_usd = priceUsd;
    }

    // 4. Clean up legacy layoff_support root if exists
    if ((finalConfig as any).layoff_support) delete (finalConfig as any).layoff_support;

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
