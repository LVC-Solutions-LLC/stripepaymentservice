import { adminDb } from '../src/config/firebase';
import * as dotenv from 'dotenv';
dotenv.config();

async function run() {
  const doc = await adminDb.doc('configurations/pricing').get();
  console.log('Firebase QA DB configuration:');
  console.log(JSON.stringify(doc.data()?.subscriptions?.company, null, 2));
}

run();
