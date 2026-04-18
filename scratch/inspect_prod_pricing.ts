
import admin from 'firebase-admin';

// Initialize Firebase with the production project ID from the metadata
const firebaseConfig = {
    projectId: "fair-job-d2242",
};

if (!admin.apps.length) {
    admin.initializeApp(firebaseConfig);
}

const db = admin.firestore();

async function inspectPricing() {
    console.log('🔍 Inspecting Production Pricing Configuration...');
    
    try {
        const pricingDoc = await db.collection('configurations').doc('pricing').get();
        if (!pricingDoc.exists) {
            console.error('❌ Pricing configuration document not found!');
            return;
        }

        const data = pricingDoc.data();
        console.log('\n--- Current Pricing Config (Firestore) ---');
        console.log(JSON.stringify(data, null, 2));

        console.log('\n--- Active Checks ---');
        // Check for common suspect price IDs
        const suspectIds = ['price_jobseeker_basic_us_monthly', 'price_company_1_seat_us_monthly'];
        
        const stringified = JSON.stringify(data);
        suspectIds.forEach(id => {
            if (stringified.includes(id)) {
                console.warn(`⚠️  WARNING: Found suspect hardcoded Price ID: ${id}`);
                console.warn(`    These are likely placeholders and will NOT work in Stripe Live mode.`);
            }
        });

    } catch (err) {
        console.error('❌ Error fetching pricing:', err);
    }
}

inspectPricing();
