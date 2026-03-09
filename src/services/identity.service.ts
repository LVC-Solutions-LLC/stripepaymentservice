import { getStripe } from '../config/stripe';
import { db } from '../config/db';
import { env } from '../config/env';
import { AppError } from '../utils/AppError';
import { FieldValue } from 'firebase-admin/firestore';

export class IdentityService {
    /**
     * Create a Stripe Identity VerificationSession.
     */
    async createVerificationSession(
        userId: string,
        email: string,
        role: string,
        returnUrl?: string,
        stripeMode?: 'test' | 'live'
    ) {
        const stripe = getStripe(stripeMode);
        const userRef = db.collection('users').doc(userId);
        const userDoc = await userRef.get();

        const statusUpdate = {
            identityVerificationStatus: 'unverified',
            identityDocumentStatus: 'unverified',
            updatedAt: FieldValue.serverTimestamp(),
        };

        if (!userDoc.exists) {
            // Create new user record
            await userRef.set({
                email,
                role,
                ...statusUpdate,
                createdAt: FieldValue.serverTimestamp(),
            });
        } else {
            // Update existing user status to reset it for the new session
            await userRef.update(statusUpdate);
        }

        // 2. Create VerificationSession
        console.log(`[STRIPE] Creating session for user: ${userId}, email: ${email}, role: ${role}`);

        const session = await stripe.identity.verificationSessions.create({
            type: 'document',
            options: {
                document: {
                    require_matching_selfie: true,
                },
            },
            client_reference_id: userId,
            metadata: {
                userId,
                email,
                role,
            },
            return_url: returnUrl || `${env.FRONTEND_URL}/verification-status`,
        });

        console.log(`✅ Identity Session created for user ${userId}: ${session.id}`);
        console.log(`🔗 Verification URL: ${session.url}`);

        // 3. Log the session in database
        await db.collection('verifications').doc(session.id).set({
            userId,
            sessionId: session.id,
            status: session.status,
            type: 'STRIPE_IDENTITY',
            createdAt: FieldValue.serverTimestamp(),
        });

        return {
            id: session.id,
            client_secret: session.client_secret,
            url: session.url,
        };
    }

    async getVerificationSession(sessionId: string, stripeMode?: 'test' | 'live', requestedUserId?: string) {
        const stripe = getStripe(stripeMode);
        const session = await stripe.identity.verificationSessions.retrieve(sessionId);

        // SYNC LOGIC: If we got a status, update Firestore to prevent stale records if webhooks were missed
        const userId = session.metadata?.userId || session.client_reference_id || requestedUserId;

        if (userId) {
            const status = session.status;

            const dbStatus = status === 'verified' ? 'verified' :
                status === 'requires_input' ? 'requires_input' :
                    status === 'processing' ? 'processing' :
                        status === 'canceled' ? 'failed' : status;

            console.log(`[SYNC] Updating Firestore for user ${userId}. New status: ${dbStatus}`);

            const userUpdate = await db.collection('users').doc(userId).update({
                identityVerificationStatus: dbStatus,
                identityDocumentStatus: dbStatus,
                updatedAt: FieldValue.serverTimestamp(),
            });

            console.log(`[SYNC] User document updated at: ${userUpdate.writeTime.toDate().toISOString()}`);

            const verificationUpdate = await db.collection('verifications').doc(sessionId).set({
                userId,
                status: status,
                updatedAt: FieldValue.serverTimestamp(),
            }, { merge: true });

            console.log(`[SYNC] Verification record updated at: ${verificationUpdate.writeTime.toDate().toISOString()}`);
        }

        return session;
    }

    async getLatestVerificationSession(userId: string, stripeMode: 'test' | 'live' = 'test'): Promise<any> {
        console.log(`[LATEST] Fetching last verification for user: ${userId}`);

        const snapshot = await db.collection('verifications')
            .where('userId', '==', userId)
            .orderBy('createdAt', 'desc')
            .limit(1)
            .get();

        if (snapshot.empty) {
            console.log(`[LATEST] No sessions found for user ${userId}`);
            return null;
        }

        const latestDoc = snapshot.docs[0];
        const sessionId = latestDoc.id;
        console.log(`[LATEST] Found session ID: ${sessionId}. Fetching from Stripe...`);

        return this.getVerificationSession(sessionId, stripeMode, userId);
    }
}
