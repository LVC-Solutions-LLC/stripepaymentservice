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

async function inspectPricing() {
    try {
        const pricingDoc = await db.collection('configurations').doc('pricing').get();
        if (!pricingDoc.exists) {
            console.error('❌ Pricing configuration document not found!');
            return;
        }

        const data = pricingDoc.data();
        fs.writeFileSync('dev_pricing.json', JSON.stringify(data, null, 2));
        console.log('✅ Wrote to dev_pricing.json');
    } catch (err) {
        console.error('❌ Error fetching pricing:', err);
    }
}

inspectPricing();
