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
 * name + date of birth. This lets us detect the same physical
 * person across different accounts WITHOUT storing raw PII.
 */
function buildIdentityFingerprint(
    firstName: string,
    lastName: string,
    dob: { day: number; month: number; year: number } | null | undefined
): string {
    const dobStr = dob ? `${dob.year}-${String(dob.month).padStart(2, '0')}-${String(dob.day).padStart(2, '0')}` : 'unknown';
    const raw = `${normaliseName(firstName)}|${normaliseName(lastName)}|${dobStr}`;
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
                lastError: session.last_error || null,
                updatedAt: FieldValue.serverTimestamp(),
            }, { merge: true });

            console.log(`[SYNC] Verification record updated at: ${verificationUpdate.writeTime.toDate().toISOString()}`);
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
     * Called by the webhook when a verification session is marked `verified`.
     * Performs two checks:
     *   1. Name match — compares Stripe's extracted name against the form name.
     *   2. Duplicate person — checks whether this physical identity has already
     *      been verified under a different userId.
     *
     * Writes the final status back to Firestore accordingly.
     */
    async validateAndFinalizeVerification(
        session: any, // The full Stripe VerificationSession object from the webhook
    ): Promise<void> {
        const userId: string | undefined =
            session.metadata?.userId || session.client_reference_id;

        if (!userId) {
            console.warn(`[FINALIZE] No userId found on session ${session.id}. Skipping validation.`);
            return;
        }

        // -----------------------------------------------------------------------
        // 1. Extract verified outputs
        // -----------------------------------------------------------------------
        const outputs = session.verified_outputs;
        const stripeFirstName: string = outputs?.first_name || '';
        const stripeLastName:  string = outputs?.last_name  || '';
        const stripeDob = outputs?.dob || null; // { day, month, year }

        console.log(`[FINALIZE] Session ${session.id} verified for user ${userId}.`);
        console.log(`[FINALIZE] Stripe name: "${stripeFirstName} ${stripeLastName}", DOB: ${JSON.stringify(stripeDob)}`);

        // -----------------------------------------------------------------------
        // 2. Retrieve the form name that was saved when the session was created
        //    (stored in session metadata AND in the verifications Firestore doc)
        // -----------------------------------------------------------------------
        const formFirstName: string = session.metadata?.formFirstName || '';
        const formLastName:  string = session.metadata?.formLastName  || '';

        // Fall back to Firestore if metadata is missing
        let resolvedFormFirst = formFirstName;
        let resolvedFormLast  = formLastName;

        if (!resolvedFormFirst || !resolvedFormLast) {
            const verDoc = await db.collection('verifications').doc(session.id).get();
            if (verDoc.exists) {
                const vd = verDoc.data()!;
                resolvedFormFirst = resolvedFormFirst || vd.formFirstName || '';
                resolvedFormLast  = resolvedFormLast  || vd.formLastName  || '';
            }
        }

        // If still missing, fall back to the users collection
        if (!resolvedFormFirst || !resolvedFormLast) {
            const userDoc = await db.collection('users').doc(userId).get();
            if (userDoc.exists) {
                const ud = userDoc.data()!;
                resolvedFormFirst = resolvedFormFirst || ud.firstName || '';
                resolvedFormLast  = resolvedFormLast  || ud.lastName  || '';
            }
        }

        console.log(`[FINALIZE] Form name: "${resolvedFormFirst} ${resolvedFormLast}"`);

        // -----------------------------------------------------------------------
        // 3. Name match check
        // -----------------------------------------------------------------------
        let nameMatchStatus: 'matched' | 'mismatch' | 'unavailable';

        if (!stripeFirstName && !stripeLastName) {
            // Stripe didn't return a name — treat as unavailable (don't block)
            nameMatchStatus = 'unavailable';
            console.warn(`[FINALIZE] Stripe returned no name for session ${session.id}. Marking as unavailable.`);
        } else {
            const firstMatch = namePartsMatch(stripeFirstName, resolvedFormFirst);
            const lastMatch  = namePartsMatch(stripeLastName,  resolvedFormLast);

            nameMatchStatus = (firstMatch && lastMatch) ? 'matched' : 'mismatch';
            console.log(`[FINALIZE] Name match — first: ${firstMatch}, last: ${lastMatch} → ${nameMatchStatus}`);
        }

        // If there's a mismatch → block the user immediately
        if (nameMatchStatus === 'mismatch') {
            await db.collection('users').doc(userId).update({
                identityVerificationStatus: 'name_mismatch',
                identityDocumentStatus:     'name_mismatch',
                nameMatchStatus,
                stripeVerifiedFirstName: stripeFirstName,
                stripeVerifiedLastName:  stripeLastName,
                updatedAt: FieldValue.serverTimestamp(),
            });

            await db.collection('verifications').doc(session.id).set({
                status: 'name_mismatch',
                nameMatchStatus,
                validationDetails: {
                    formFirstName: resolvedFormFirst,
                    formLastName:  resolvedFormLast,
                    stripeFirstName: stripeFirstName,
                    stripeLastName:  stripeLastName,
                },
                updatedAt: FieldValue.serverTimestamp(),
            }, { merge: true });

            // Write an admin alert so the team can review
            await db.collection('admin_alerts').add({
                type: 'IDENTITY_NAME_MISMATCH',
                userId,
                sessionId: session.id,
                formName: `${resolvedFormFirst} ${resolvedFormLast}`,
                stripeName: `${stripeFirstName} ${stripeLastName}`,
                createdAt: FieldValue.serverTimestamp(),
            });

            console.log(`[FINALIZE] ❌ Name mismatch for user ${userId}. Blocked.`);
            return; // Stop — do not proceed to duplicate check
        }

        // -----------------------------------------------------------------------
        // 4. Duplicate-person check
        //    Build a fingerprint from name + DOB and check verified_identities
        // -----------------------------------------------------------------------
        if (stripeFirstName && stripeLastName) {
            const fingerprint = buildIdentityFingerprint(stripeFirstName, stripeLastName, stripeDob);
            console.log(`[FINALIZE] Identity fingerprint: ${fingerprint}`);

            const existingSnap = await db.collection('verified_identities').doc(fingerprint).get();

            if (existingSnap.exists) {
                const existingData = existingSnap.data()!;

                if (existingData.userId !== userId) {
                    // Same person, different account → block
                    console.warn(`[FINALIZE] 🚨 Duplicate identity detected! Existing user: ${existingData.userId}, new user: ${userId}`);

                    await db.collection('users').doc(userId).update({
                        identityVerificationStatus: 'duplicate_person',
                        identityDocumentStatus:     'duplicate_person',
                        nameMatchStatus,
                        verificationBlockReason:    'An account with this identity has already been verified.',
                        updatedAt: FieldValue.serverTimestamp(),
                    });

                    await db.collection('verifications').doc(session.id).set({
                        status: 'duplicate_person',
                        fingerprint,
                        validationDetails: {
                            existingUserId: existingData.userId,
                            fingerprint,
                        },
                        updatedAt: FieldValue.serverTimestamp(),
                    }, { merge: true });

                    // Admin alert
                    await db.collection('admin_alerts').add({
                        type: 'IDENTITY_DUPLICATE_PERSON',
                        newUserId: userId,
                        existingUserId: existingData.userId,
                        sessionId: session.id,
                        fingerprint,
                        createdAt: FieldValue.serverTimestamp(),
                    });

                    return; // Blocked
                }

                // Same user re-verifying — update the record
                console.log(`[FINALIZE] Same user ${userId} re-verified. Updating fingerprint record.`);
                await db.collection('verified_identities').doc(fingerprint).update({
                    sessionId: session.id,
                    verifiedAt: FieldValue.serverTimestamp(),
                });
            } else {
                // First time this identity is verified — store the fingerprint
                await db.collection('verified_identities').doc(fingerprint).set({
                    userId,
                    sessionId: session.id,
                    verifiedAt: FieldValue.serverTimestamp(),
                });
                console.log(`[FINALIZE] ✅ New identity fingerprint stored for user ${userId}.`);
            }
        }

        // -----------------------------------------------------------------------
        // 5. All checks passed → mark as fully verified
        // -----------------------------------------------------------------------
        await db.collection('users').doc(userId).update({
            identityVerified: true,
            identityVerificationStatus: 'verified',
            identityDocumentStatus:     'verified',
            nameMatchStatus,
            stripeVerifiedFirstName: stripeFirstName,
            stripeVerifiedLastName:  stripeLastName,
            updatedAt: FieldValue.serverTimestamp(),
        });

        await db.collection('verifications').doc(session.id).set({
            status: 'verified',
            nameMatchStatus,
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        console.log(`[FINALIZE] ✅ User ${userId} fully verified.`);
    }
}
