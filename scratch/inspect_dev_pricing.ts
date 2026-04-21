import admin from 'firebase-admin';
import path from 'path';

// If FIREBASE_APPLICATION_CREDENTIALS is not set, this might fail relying on default credentials.
// In dev we usually use service account. Let's provide it if available.
import dotenv from 'dotenv';
dotenv.config();

const firebaseConfig = {
    projectId: "fairjob-dev",
};

if (!admin.apps.length) {
    // If running in dev repo, we might need GOOGLE_APPLICATION_CREDENTIALS setup, let's just initialize.
    admin.initializeApp(firebaseConfig);
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
        console.log(JSON.stringify(data, null, 2));
    } catch (err) {
        console.error('❌ Error fetching pricing:', err);
    }
}

inspectPricing();
