import * as admin from 'firebase-admin';
import * as dotenv from 'dotenv';
import * as fs from 'fs';

// Read LVC-job-portal dev env
const envData = fs.readFileSync('/Users/gnanaprakash/Documents/GitHub/LVC-job-portal/.env.dev', 'utf-8');
const envConfig = dotenv.parse(envData);

if (!admin.apps.length) {
    if (envConfig.FB_PRIVATE_KEY) {
        admin.initializeApp({
            credential: admin.credential.cert({
                projectId: envConfig.FB_PROJECT_ID,
                clientEmail: envConfig.FB_CLIENT_EMAIL,
                privateKey: envConfig.FB_PRIVATE_KEY.replace(/\\n/g, '\n'),
            }),
        });
    } else {
        admin.initializeApp();
    }
}

const db = admin.firestore();

function repairPricingObject(obj: any) {
    if (!obj || typeof obj !== 'object') return obj;

    // Replace nested ones with the root ones
    if (obj.stripePriceId_inr && obj.india && typeof obj.india === 'object') {
        obj.india.stripePriceId_inr = obj.stripePriceId_inr;
    }
    if (obj.stripePriceId_usd && obj.global && typeof obj.global === 'object') {
        obj.global.stripePriceId_usd = obj.stripePriceId_usd;
    }
    
    // Also if root has productId, make sure nested has it too
    if (obj.stripeProductId && obj.india && typeof obj.india === 'object') {
        obj.india.stripeProductId = obj.stripeProductId;
    }
    if (obj.stripeProductId && obj.global && typeof obj.global === 'object') {
        obj.global.stripeProductId = obj.stripeProductId;
    }

    for (const key of Object.keys(obj)) {
        if (typeof obj[key] === 'object') {
            repairPricingObject(obj[key]);
        }
    }
    return obj;
}

async function fixPricing() {
    try {
        const pricingRef = db.collection('configurations').doc('pricing');
        const doc = await pricingRef.get();
        if (!doc.exists) {
            console.error('❌ Pricing configuration document not found!');
            return;
        }

        const data = doc.data() as any;
        
        // Let's copy it and repair
        const fixedData = JSON.parse(JSON.stringify(data));
        
        // Deep traverse and repair
        // oneTime
        for (const role of Object.keys(fixedData.oneTime || {})) {
            repairPricingObject(fixedData.oneTime[role]);
        }
        // subscriptions
        for (const role of Object.keys(fixedData.subscriptions || {})) {
            for (const tier of Object.keys(fixedData.subscriptions[role])) {
                repairPricingObject(fixedData.subscriptions[role][tier]);
            }
        }
        // addons
        for (const addon of Object.keys(fixedData.addons || {})) {
            repairPricingObject(fixedData.addons[addon]);
        }
        
        // Additionally verify job_seeker directly
        if (fixedData.oneTime?.job_seeker?.india?.stripePriceId_inr) {
            console.log('Old oneTime job_seeker INDIA price:', data.oneTime.job_seeker.india.stripePriceId_inr);
            console.log('New oneTime job_seeker INDIA price:', fixedData.oneTime.job_seeker.india.stripePriceId_inr);
        }

        // Just blindly repair everything as fallback
        repairPricingObject(fixedData);

        // Update firestore
        // Wait, some prices are STILL price_1TLc... if there was no root property to replace it!
        // The error specifically mentions `price_1TLcTOG7HDya9H68BF0RThuY`.
        // That is job_seeker.india.stripePriceId_inr.
        // In the data, root has `price_1TLqERG7HDya9H685ZKE3yOB`. So it WILL be replaced.

        await pricingRef.set(fixedData);
        console.log('✅ Successfully updated pricing configuration with test mode IDs!');
        fs.writeFileSync('dev_pricing_fixed.json', JSON.stringify(fixedData, null, 2));

    } catch (err) {
        console.error('❌ Error fixing pricing:', err);
    }
}

fixPricing();
