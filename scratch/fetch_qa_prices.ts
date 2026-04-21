import * as admin from 'firebase-admin';
import * as dotenv from 'dotenv';

// Use LVC-job-portal QA env
dotenv.config({ path: '../LVC-job-portal/.env.qa' });

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FB_PROJECT_ID || 'fairjob-qa',
            clientEmail: process.env.FB_CLIENT_EMAIL,
            privateKey: process.env.FB_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        }),
    });
}

const db = admin.firestore();

async function checkQaPrices() {
    try {
        const doc = await db.collection('configurations').doc('pricing').get();
        if (!doc.exists) {
            console.error('QA Pricing configuration document not found!');
            return;
        }

        const data = doc.data() as any;
        console.log('--- QA PRICING CONFIG FOR COMPANY ---');
        console.log(JSON.stringify(data?.subscriptions?.company, null, 2));
    } catch (err) {
        console.error('Error fetching pricing:', err);
    }
}

checkQaPrices();
