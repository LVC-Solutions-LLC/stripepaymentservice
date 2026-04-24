import { getStripe } from '../config/stripe';
import { db } from '../config/db';
import { env } from '../config/env';
import { AppError } from '../utils/AppError';
import { FieldValue } from 'firebase-admin/firestore';
import * as crypto from 'crypto';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalise a name string for fuzzy comparison:
 * lowercase, trim, remove non-alpha characters.
 */
function normaliseName(s: string | undefined | null): string {
    if (!s) return '';
    return s.trim().toLowerCase().replace(/[^a-z]/g, '');
}

/**
 * Returns true if the two normalised name parts are considered a match.
 * Handles common cases like "Jonathan" ↔ "Jon" by prefix matching.
 */
function namePartsMatch(a: string, b: string): boolean {
    if (!a || !b) return false;
    const na = normaliseName(a);
    const nb = normaliseName(b);
    return na === nb || na.startsWith(nb) || nb.startsWith(na);
}

/**
 * Build a SHA-256 fingerprint for a verified person based on
 * name + date of birth. This version detects name swaps (e.g. "First Last" vs "Last First")
 * by sorting the name parts alphabetically.
 */
function buildIdentityFingerprint(
    firstName: string,
    lastName: string,
    dob: { day: number; month: number; year: number } | null | undefined
): string {
    const dobStr = dob ? `${dob.year}-${String(dob.month).padStart(2, '0')}-${String(dob.day).padStart(2, '0')}` : 'unknown';
    
    // Sort name parts alphabetically to handle swaps
    const normalisedParts = [normaliseName(firstName), normaliseName(lastName)].filter(Boolean).sort();
    const raw = `${normalisedParts.join('|')}|${dobStr}`;
    
    return crypto.createHash('sha256').update(raw).digest('hex');
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class IdentityService {
    /**
     * Create a Stripe Identity VerificationSession.
     * Optionally accepts the user's self-declared first/last name from the
     * sign-up form so we can compare them against the document later.
     */
    async createVerificationSession(
        userId: string,
        email: string,
        role: string,
        returnUrl?: string,
        stripeMode?: 'test' | 'live',
        formFirstName?: string,
        formLastName?: string,
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

        console.log(`[STRIPE] Creating session for user: ${userId}, email: ${email}, role: ${role}`);

        // Build metadata — include form name if supplied so the webhook can
        // retrieve it without a separate Firestore read.
        const metadata: Record<string, string> = {
            userId,
            email,
            role,
        };
        if (formFirstName) metadata.formFirstName = formFirstName;
        if (formLastName)  metadata.formLastName  = formLastName;

        const session = await stripe.identity.verificationSessions.create({
            type: 'document',
            options: {
                document: {
                    require_matching_selfie: true,
                },
            },
            client_reference_id: userId,
            metadata,
            return_url: returnUrl || `${env.FRONTEND_URL}/verification-status`,
        });

        console.log(`✅ Identity Session created for user ${userId}: ${session.id}`);
        console.log(`🔗 Verification URL: ${session.url}`);

        // Log the session in the database, including the declared form name
        await db.collection('verifications').doc(session.id).set({
            userId,
            sessionId: session.id,
            status: session.status,
            type: 'STRIPE_IDENTITY',
            formFirstName: formFirstName || null,
            formLastName:  formLastName  || null,
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

            // If the session is verified, we MUST run the validation logic (Duplicate check, name match)
            // This prevents the "polling loophole".
            if (status === 'verified') {
                console.log(`[SYNC] Session ${sessionId} is VERIFIED on Stripe. Running validation logic...`);
                await this.internalValidateUserIdentity(session);
                // The internal method handles database updates for users/verifications
            } else {
                const dbStatus = status === 'requires_input' ? 'requires_input' :
                                status === 'processing' ? 'processing' :
                                status === 'canceled' ? 'failed' : status;

                console.log(`[SYNC] Updating Firestore for user ${userId}. New status: ${dbStatus}`);

                await db.collection('users').doc(userId).update({
                    identityVerificationStatus: dbStatus,
                    identityDocumentStatus: dbStatus,
                    updatedAt: FieldValue.serverTimestamp(),
                });

                await db.collection('verifications').doc(sessionId).set({
                    userId,
                    status: status,
                    lastError: session.last_error || null,
                    updatedAt: FieldValue.serverTimestamp(),
                }, { merge: true });
            }
        }

        return session;
    }

    async getLatestVerificationSession(userId: string, stripeMode: 'test' | 'live' = 'test'): Promise<any> {
        console.log(`[LATEST] Fetching last verification for user: ${userId}`);

        // WORKAROUND: Remove .orderBy() to avoid requiring a composite index in new environments (QA/Dev)
        const snapshot = await db.collection('verifications')
            .where('userId', '==', userId)
            .get();

        if (snapshot.empty) {
            console.log(`[LATEST] No sessions found for user ${userId}`);
            return null;
        }

        // Sort in memory by createdAt descending
        const docs = snapshot.docs.map(d => ({ 
            id: d.id, 
            ...d.data() 
        })) as any[];

        docs.sort((a, b) => {
            const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : (a.createdAt?._seconds || 0) * 1000;
            const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : (b.createdAt?._seconds || 0) * 1000;
            return timeB - timeA;
        });

        const latestDoc = docs[0];
        const sessionId = latestDoc.id;
        console.log(`[LATEST] Found session ID: ${sessionId} via in-memory sort. Fetching from Stripe...`);

        return this.getVerificationSession(sessionId, stripeMode, userId);
    }

    /**
     * Entry point for Stripe Webhooks.
     */
    async validateAndFinalizeVerification(
        session: any, // The full Stripe VerificationSession object from the webhook
    ): Promise<void> {
        await this.internalValidateUserIdentity(session);
    }

    /**
     * UNIFIED VALIDATION LOGIC
     * Performs Name Match, Duplicate Fingerprint Search, and Name Repetition checks.
     * Transitions cases to 'verified', 'under_review', 'name_mismatch', or 'duplicate_person'.
     */
    private async internalValidateUserIdentity(session: any): Promise<void> {
        const sessionId = session.id;
        const userId: string | undefined = session.metadata?.userId || session.client_reference_id;

        if (!userId) {
            console.warn(`[VALIDATE] No userId found on session ${sessionId}. Skipping.`);
            return;
        }

        // Check if we already finalised this session to avoid double-processing
        const existingVer = await db.collection('verifications').doc(sessionId).get();
        if (existingVer.exists && (existingVer.data()?.status === 'verified' || existingVer.data()?.status === 'under_review')) {
            console.log(`[VALIDATE] Session ${sessionId} already processed. Skipping.`);
            return;
        }

        // 1. Extract verified outputs
        const outputs = session.verified_outputs;
        const stripeFirstName: string = outputs?.first_name || '';
        const stripeLastName:  string = outputs?.last_name  || '';
        const stripeDob = outputs?.dob || null; // { day, month, year }

        // 2. Retrieve form name
        let resolvedFormFirst = session.metadata?.formFirstName || '';
        let resolvedFormLast  = session.metadata?.formLastName  || '';

        if (!resolvedFormFirst || !resolvedFormLast) {
            if (existingVer.exists) {
                resolvedFormFirst = existingVer.data()?.formFirstName || '';
                resolvedFormLast  = existingVer.data()?.formLastName  || '';
            }
            if (!resolvedFormFirst || !resolvedFormLast) {
                const userDoc = await db.collection('users').doc(userId).get();
                if (userDoc.exists) {
                    resolvedFormFirst = resolvedFormFirst || userDoc.data()?.firstName || '';
                    resolvedFormLast  = resolvedFormLast  || userDoc.data()?.lastName  || '';
                }
            }
        }

        const suspiciousReasons: string[] = [];
        let nameMatchStatus: 'matched' | 'mismatch' | 'unavailable' = 'matched';

        // 3. Name match check
        if (stripeFirstName || stripeLastName) {
            const firstMatch = namePartsMatch(stripeFirstName, resolvedFormFirst);
            const lastMatch  = namePartsMatch(stripeLastName,  resolvedFormLast);
            
            if (!firstMatch || !lastMatch) {
                nameMatchStatus = 'mismatch';
                suspiciousReasons.push('Name on Profile (Expected) vs Name on ID (Detected) mismatch');
            }
        } else {
            nameMatchStatus = 'unavailable';
        }

        let existingFingerprintUserId = null;

        // 4. Duplicate fingerprint check (Name + DOB)
        if (stripeFirstName && stripeLastName) {
            const fingerprint = buildIdentityFingerprint(stripeFirstName, stripeLastName, stripeDob);
            const existingSnap = await db.collection('verified_identities').doc(fingerprint).get();

            if (existingSnap.exists) {
                const existingData = existingSnap.data()!;
                if (existingData.userId !== userId) {
                    existingFingerprintUserId = existingData.userId;
                    suspiciousReasons.push(`Duplicate Profile: Identity SHA-256 fingerprint matches existing verified user ${existingData.userId}`);
                }
            }

            // 5. Name Repetition Check (Search for same name + DOB in users collection)
            // This catches people who might have been verified before fingerprinting was implemented.
            const similarUsers = await db.collection('users')
                .where('stripeVerifiedFirstName', '==', stripeFirstName)
                .where('stripeVerifiedLastName', '==', stripeLastName)
                .get();
            
            const duplicates = similarUsers.docs.filter(d => d.id !== userId);
            if (duplicates.length > 0) {
                suspiciousReasons.push(`Name Duplicate: ${duplicates.length} other accounts found with this exact name and verified identity.`);
            }

            // Record/Update the fingerprint if everything else seems okay OR if it's the same user re-verifying
            if (suspiciousReasons.length === 0) {
                await db.collection('verified_identities').doc(fingerprint).set({
                    userId,
                    sessionId,
                    verifiedAt: FieldValue.serverTimestamp(),
                });
            }
        }

        // 6. Determine final status
        let finalStatus: string = 'verified';
        if (suspiciousReasons.length > 0) {
            // "Under Review" for suspicious cases
            finalStatus = 'under_review';
        }

        console.log(`[VALIDATE] User ${userId} final validation status: ${finalStatus}. Reasons: ${suspiciousReasons.join(', ')}`);

        // 7. Update User
        await db.collection('users').doc(userId).update({
            identityVerified: finalStatus === 'verified',
            identityVerificationStatus: finalStatus,
            identityDocumentStatus:     finalStatus,
            nameMatchStatus,
            suspiciousReasons,
            stripeVerifiedFirstName: stripeFirstName,
            stripeVerifiedLastName:  stripeLastName,
            updatedAt: FieldValue.serverTimestamp(),
        });

        // 8. Update Verification Record
        await db.collection('verifications').doc(sessionId).set({
            status: finalStatus,
            nameMatchStatus,
            suspiciousReasons,
            validationDetails: {
                formFirstName: resolvedFormFirst,
                formLastName:  resolvedFormLast,
                stripeFirstName,
                stripeLastName,
                dob: stripeDob,
                existingUserId: existingFingerprintUserId
            },
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        // 9. Create Admin Alert if suspicious
        if (suspiciousReasons.length > 0) {
            await db.collection('admin_alerts').add({
                type: 'IDENTITY_SUSPICIOUS_ACTIVITY',
                userId,
                sessionId,
                reasons: suspiciousReasons,
                createdAt: FieldValue.serverTimestamp(),
            });
        }

        console.log(`[VALIDATE] ✅ User ${userId} final status: ${finalStatus}`);
    }
}
