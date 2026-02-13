import { db } from '../src/config/db';

async function checkPayment(paymentId: string) {
    try {
        console.log(`Checking Payment ID: ${paymentId}`);
        const doc = await db.collection('payments').doc(paymentId).get();
        if (doc.exists) {
            console.log('✅ Payment found in Firestore:', doc.data());
        } else {
            console.log('❌ Payment NOT found in Firestore.');
        }
    } catch (error) {
        console.error('Error fetching document:', error);
    }
}

// Payment ID from user's response
checkPayment('pi_3SxxAZSorugVCXFj0lneQ7Nw');
