import * as admin from 'firebase-admin';
import * as dotenv from 'dotenv';
import * as fs from 'fs';

// Use LVC-job-portal QA env
const envData = fs.readFileSync('/Users/gnanaprakash/Documents/GitHub/LVC-job-portal/.env.qa', 'utf-8');
const envConfig = dotenv.parse(envData);

// App for Prod
const prodApp = admin.initializeApp({
    credential: admin.credential.cert({
        projectId: envConfig.PROD_FB_PROJECT_ID,
        clientEmail: envConfig.PROD_FB_CLIENT_EMAIL,
        privateKey: envConfig.PROD_FB_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
}, 'prod');

// App for QA
const qaApp = admin.initializeApp({
    credential: admin.credential.cert({
        projectId: envConfig.FB_PROJECT_ID,
        clientEmail: envConfig.FB_CLIENT_EMAIL,
        privateKey: envConfig.FB_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
}, 'qa');

const prodDb = prodApp.firestore();
const qaDb = qaApp.firestore();

async function syncProdToQa() {
    try {
        console.log('Fetching Prod Pricing Config...');
        const prodDoc = await prodDb.collection('configurations').doc('pricing').get();
        if (!prodDoc.exists) {
            console.error('Prod Pricing configuration document not found!');
            return;
        }

        const data = prodDoc.data();
        console.log('Successfully fetched Prod Pricing data. Writing to QA DB...');

        await qaDb.collection('configurations').doc('pricing').set(data!);
        console.log('Successfully synced QA Pricing config to mirror Prod!');
    } catch (err) {
        console.error('Error syncing pricing:', err);
    }
}

syncProdToQa();
