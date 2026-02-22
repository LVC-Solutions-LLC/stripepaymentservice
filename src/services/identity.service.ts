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
        stripeMode?: 'test' | 'live'
    ) {
        const stripe = getStripe(stripeMode);
        // 1. Check if user exists or create them
        const userRef = db.collection('users').doc(userId);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            // If user doesn't exist, we might want to create them or throw error.
            // For now, let's just ensure we have a record to update later via webhooks.
            await userRef.set({
                email,
                role,
                verificationStatus: 'requires_input',
                createdAt: FieldValue.serverTimestamp(),
            });
        }

        // 2. Create VerificationSession
        // We configure it to require document and selfie for all roles requested
        const session = await stripe.identity.verificationSessions.create({
            type: 'document',
            options: {
                document: {
                    require_matching_selfie: true,
                },
            },
            metadata: {
                userId,
                email,
                role,
            },
            return_url: `${env.FRONTEND_URL}/verification-status?session_id={VERIFICATION_SESSION_ID}`, // Corrected placeholder
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

    async getVerificationSession(sessionId: string, stripeMode?: 'test' | 'live') {
        const stripe = getStripe(stripeMode);
        return await stripe.identity.verificationSessions.retrieve(sessionId);
    }
}
