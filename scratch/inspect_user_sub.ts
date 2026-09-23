import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

const possiblePaths = [
    path.resolve(process.cwd(), `.env.dev`),
    path.resolve(__dirname, `../.env.dev`),
];
let loadedEnvPath = possiblePaths.find(p => fs.existsSync(p));
if (loadedEnvPath) {
    dotenv.config({ path: loadedEnvPath, override: true });
}

async function inspectUser() {
    const { db } = await import('../src/config/db');
    const userId = process.argv[2] || 'RRIYEa3q1KU5dYlJmwCmvDmqh2l1';

    console.log(`\n🔍 Inspecting Firestore for user: ${userId}`);
    const userDoc = await db.collection('users').doc(userId).get();

    if (!userDoc.exists) {
        console.log(`❌ User doc ${userId} does NOT exist in 'users' collection!`);
        
        // List top 5 users to help identify the right ID
        console.log('\nListing recent users in Firestore:');
        const usersSnap = await db.collection('users').limit(5).get();
        usersSnap.docs.forEach(doc => {
            console.log(`- ID: ${doc.id} | Email: ${doc.data()?.email} | Role: ${doc.data()?.role}`);
        });
        return;
    }

    const data = userDoc.data();
    console.log('✅ User Doc Data:');
    console.log('Email:', data?.email);
    console.log('Role:', data?.role);
    console.log('activeSubscription:', JSON.stringify(data?.activeSubscription, null, 2));
}

inspectUser().catch(console.error);
