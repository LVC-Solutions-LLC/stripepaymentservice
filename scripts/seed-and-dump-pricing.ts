import dotenv from 'dotenv';
dotenv.config({ path: '.env.dev' });

import { AdminPricingService } from '../src/services/admin.pricing.service';
import { db } from '../src/config/db';
import defaultPricing from '../src/config/defaultPricing.json';
import fs from 'fs';
import path from 'path';

const adminPricingService = new AdminPricingService();

async function seedAndDumpPricing() {
    const stripeMode = (process.argv[2] as 'test' | 'live') || 'test';
    console.log(`\n🚀 Starting Pricing Seed & Stripe Sync in [${stripeMode.toUpperCase()}] mode...`);

    try {
        // 1. Fetch current config from Firestore, fallback to defaultPricing.json
        const doc = await db.collection('configurations').doc('pricing').get();
        let baseConfig: any;

        if (doc.exists && doc.data() && Object.keys(doc.data()!).length > 0) {
            console.log(`📄 Loaded existing pricing config from Firestore ('configurations/pricing').`);
            baseConfig = doc.data();
        } else {
            console.log(`📄 Firestore pricing empty. Loaded initial default pricing from defaultPricing.json.`);
            baseConfig = defaultPricing;
        }

        // 2. Run syncFullPricingConfig (Creates Stripe Products/Prices + updates Firestore)
        console.log(`⚡ Creating/syncing Stripe Products and Prices with rate-limit protection...`);
        const syncedResults = await adminPricingService.syncFullPricingConfig(baseConfig, stripeMode);

        // 3. Write Dump JSON to local files
        const dumpJson = JSON.stringify(syncedResults, null, 2);

        // Save in Payment Service scratch/
        const localDumpPath = path.join(__dirname, '../scratch/pricing_config_dump.json');
        fs.mkdirSync(path.dirname(localDumpPath), { recursive: true });
        fs.writeFileSync(localDumpPath, dumpJson, 'utf-8');
        console.log(`\n✅ Saved JSON dump to Payment Service: file://${localDumpPath}`);

        // Also save in LVC-job-portal root if directory exists
        const portalDumpPath = '/Users/gnanaprakash/Documents/GitHub/LVC-job-portal/pricing_config_dump.json';
        try {
            fs.writeFileSync(portalDumpPath, dumpJson, 'utf-8');
            console.log(`✅ Saved JSON dump to LVC-job-portal: file://${portalDumpPath}`);
        } catch (e) {
            // Ignore if portal path is not accessible
        }

        console.log(`\n==================================================`);
        console.log(`🎉 SUCCESS: Stripe Products & Prices Created & Dumped!`);
        console.log(`==================================================\n`);
        
        process.exit(0);
    } catch (err: any) {
        console.error(`\n❌ Error seeding pricing:`, err.message || err);
        process.exit(1);
    }
}

seedAndDumpPricing();
