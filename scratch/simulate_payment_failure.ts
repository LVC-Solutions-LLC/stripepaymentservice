import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Parse arguments for --env or env file name (default to .env.dev)
const args = process.argv.slice(2);
let envName = 'dev'; // default to dev
let cleanArgs: string[] = [];

for (let i = 0; i < args.length; i++) {
    if (args[i] === '--env' && args[i + 1]) {
        envName = args[i + 1].replace(/^\.env\./, '');
        i++;
    } else if (args[i].startsWith('--env=')) {
        envName = args[i].split('=')[1].replace(/^\.env\./, '');
    } else {
        cleanArgs.push(args[i]);
    }
}

// Locate env file
const possiblePaths = [
    path.resolve(process.cwd(), `.env.${envName}`),
    path.resolve(process.cwd(), `.env`),
    path.resolve(__dirname, `../.env.${envName}`),
    path.resolve(__dirname, `../.env.dev`),
];

let loadedEnvPath = possiblePaths.find(p => fs.existsSync(p));

if (loadedEnvPath) {
    dotenv.config({ path: loadedEnvPath, override: true });
    console.log(`[Simulator] Loaded environment from: ${path.basename(loadedEnvPath)}`);
} else {
    dotenv.config();
    console.warn(`[Simulator] Warning: No .env.${envName} found, using default environment`);
}

/**
 * Usage:
 *   npx ts-node scratch/simulate_payment_failure.ts <userId> <state> [--env dev|qa|prod]
 * 
 * States:
 *   - 'grace_period' : Sets failure with 48h remaining (Tests top warning banner)
 *   - 'expired'      : Sets failure past 48h (Tests full-screen non-dismissable lockout & job hiding)
 *   - 'restore'      : Restores active subscription (Tests account recovery & job unhiding)
 */
async function run() {
    const { db } = await import('../src/config/db');
    const { FieldValue } = await import('firebase-admin/firestore');

    const userId = cleanArgs[0];
    const state = cleanArgs[1] || 'grace_period';


    if (!userId) {
        console.error('❌ Error: userId is required.');
        console.log('Usage: npx ts-node scratch/simulate_payment_failure.ts <USER_ID> [grace_period | expired | restore]');
        process.exit(1);
    }

    const userRef = db.collection('users').doc(userId);
    const userSnap = await userRef.get();

    if (!userSnap.exists) {
        console.error(`❌ Error: User ${userId} not found in Firestore.`);
        process.exit(1);
    }

    const userData = userSnap.data() || {};
    const companyId = userData.registrationId || userData.companyId;

    const now = new Date();

    if (state === 'grace_period') {
        // Set grace period ending in 48 hours
        const gracePeriodEnd = new Date(now.getTime() + 48 * 60 * 60 * 1000);

        await userRef.set({
            activeSubscription: {
                status: 'past_due',
                paymentStatus: 'failed',
                planName: 'Enterprise Recruiter Plan',
                amountDue: 19.99,
                currency: 'USD',
                failedAt: now,
                gracePeriodEnd: gracePeriodEnd,
                lastPaymentError: 'Your card was declined: Insufficient funds.',
                hostedInvoiceUrl: 'https://pay.stripe.com/invoice/test_mock_inv',
                updatedAt: FieldValue.serverTimestamp(),
            }
        }, { merge: true });

        console.log(`\n✅ [STATE: GRACE PERIOD] Applied to user ${userId}`);
        console.log(`- Status: past_due`);
        console.log(`- Grace Period Ends: ${gracePeriodEnd.toISOString()} (in ~48 hours)`);
        console.log(`👉 Open your frontend: You should see the top warning banner with countdown!`);

    } else if (state === 'expired') {
        // Set grace period as ended 2 hours ago
        const gracePeriodEnd = new Date(now.getTime() - 2 * 60 * 60 * 1000);
        const failedAt = new Date(now.getTime() - 50 * 60 * 60 * 1000);

        await userRef.set({
            activeSubscription: {
                status: 'past_due',
                paymentStatus: 'failed',
                planName: 'Enterprise Recruiter Plan',
                amountDue: 19.99,
                currency: 'USD',
                failedAt: failedAt,
                gracePeriodEnd: gracePeriodEnd,
                lastPaymentError: 'Your card was declined: Card expired or blocked.',
                hostedInvoiceUrl: 'https://pay.stripe.com/invoice/test_mock_inv',
                updatedAt: FieldValue.serverTimestamp(),
            }
        }, { merge: true });

        // If company, hide active jobs
        if (companyId) {
            const jobsSnap = await db.collection('jobs')
                .where('companyId', '==', companyId)
                .where('status', '==', 'active')
                .get();

            if (!jobsSnap.empty) {
                const batch = db.batch();
                jobsSnap.docs.forEach((doc) => {
                    batch.update(doc.ref, {
                        hiddenByPaymentFailure: true,
                        status: 'paused',
                        updatedAt: FieldValue.serverTimestamp(),
                    });
                });
                await batch.commit();
                console.log(`🔒 Hidden ${jobsSnap.size} jobs for company ${companyId}`);
            }
        }

        console.log(`\n🚨 [STATE: EXPIRED LOCKOUT] Applied to user ${userId}`);
        console.log(`- Status: past_due`);
        console.log(`- Grace Period: Expired 2 hours ago`);
        console.log(`👉 Open your frontend: You should see the FULL-SCREEN non-dismissable lockout!`);

    } else if (state === 'restore') {
        // Restore active subscription
        await userRef.set({
            activeSubscription: {
                status: 'active',
                paymentStatus: 'paid',
                failedAt: null,
                gracePeriodEnd: null,
                lastPaymentError: null,
                isAccountPaused: false,
                updatedAt: FieldValue.serverTimestamp(),
            }
        }, { merge: true });

        // If company, restore hidden jobs
        if (companyId) {
            const hiddenJobsSnap = await db.collection('jobs')
                .where('companyId', '==', companyId)
                .where('hiddenByPaymentFailure', '==', true)
                .get();

            if (!hiddenJobsSnap.empty) {
                const batch = db.batch();
                hiddenJobsSnap.docs.forEach((doc) => {
                    batch.update(doc.ref, {
                        hiddenByPaymentFailure: false,
                        status: 'active',
                        updatedAt: FieldValue.serverTimestamp(),
                    });
                });
                await batch.commit();
                console.log(`✅ Restored ${hiddenJobsSnap.size} hidden jobs for company ${companyId}`);
            }
        }

        console.log(`\n🎉 [STATE: RESTORED] Applied to user ${userId}`);
        console.log(`- Status: active`);
        console.log(`👉 Open your frontend: Dashboard and jobs are back to normal!`);
    } else {
        console.error(`❌ Unknown state: ${state}. Choose: 'grace_period', 'expired', or 'restore'`);
    }
}

run().catch((err) => {
    console.error('Error running simulation script:', err);
    process.exit(1);
});
