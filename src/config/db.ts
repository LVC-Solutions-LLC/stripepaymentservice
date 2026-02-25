import admin from 'firebase-admin';
import { env } from './env';

// Initialize Firebase Admin
// dev service testing comit
// We construct the credential object manually to handle the private key newlines correctly
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: env.FIREBASE_PROJECT_ID,
            clientEmail: env.FIREBASE_CLIENT_EMAIL,
            // Replace literal \n with actual newlines if passed as a string
            privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        }),
    });
}

export const db = admin.firestore();
