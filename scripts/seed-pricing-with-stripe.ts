/**
 * Pricing + Stripe Seed Script
 * 
 * Creates/updates all Stripe products & prices in TEST mode,
 * then writes the full pricing config (with Stripe IDs) to Firestore dev DB.
 *
 * Usage:
 *   npx ts-node --project tsconfig.json scripts/seed-pricing-with-stripe.ts dev
 *
 * Requirements:
 *   STRIPE_TEST_SECRET_KEY must be set in .env.dev
 */

import * as admin from "firebase-admin";
import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";
import Stripe from "stripe";

// ── Load env ──────────────────────────────────────────────────────────────────
const envArg = process.argv[2] || "dev";
const envFile = path.resolve(process.cwd(), `.env`);

if (!fs.existsSync(envFile)) {
  console.error(`❌ Env file not found: ${envFile}`);
  process.exit(1);
}

dotenv.config({ path: envFile });
console.log(`🌍 Using env: ${envFile}`);

// ── Stripe init ───────────────────────────────────────────────────────────────
const stripeSecretKey = process.env.STRIPE_TEST_SECRET_KEY;
if (!stripeSecretKey) {
  console.error("❌ STRIPE_TEST_SECRET_KEY is not set in your env file.");
  console.error("   Add it to .env.dev:  STRIPE_TEST_SECRET_KEY=sk_test_...");
  process.exit(1);
}

const stripe = new Stripe(stripeSecretKey, { apiVersion: "2025-05-28.basil" as any });

// ── Firebase init ─────────────────────────────────────────────────────────────
const projectId = process.env.FB_PROJECT_ID!;
const clientEmail = process.env.FB_CLIENT_EMAIL!;
const privateKey = process.env.FB_PRIVATE_KEY!.replace(/\\n/g, "\n");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
  });
}

const db = admin.firestore();
const PRICING_CONFIG_PATH = "configurations/pricing";

// ── Product definitions ───────────────────────────────────────────────────────
// Each entry: { key, name, type, inrPaise, usdCents, interval? }
// type: "one_time" | "recurring"
// interval: "month" (only for recurring)

interface ProductDef {
  key: string;           // used as Stripe metadata key for lookup
  name: string;          // Stripe product name
  type: "one_time" | "recurring";
  inrPaise: number;      // price in paise (INR smallest unit)
  usdCents: number;      // price in cents (USD smallest unit)
  interval?: "month" | "year";
}

const PRODUCTS: ProductDef[] = [
  // ── Verification Fees (one-time) ──────────────────────────────────────────
  { key: "verificationFees.job_seeker",         name: "LVC FairJob: Job Seeker Verification",         type: "one_time",  inrPaise: 99900,    usdCents: 2000  },
  { key: "verificationFees.student_job_seeker", name: "LVC FairJob: Student Verification",            type: "one_time",  inrPaise: 39900,    usdCents: 1000  },
  { key: "verificationFees.recruiter",          name: "LVC FairJob: Recruiter Verification",          type: "one_time",  inrPaise: 399900,   usdCents: 9900  },
  { key: "verificationFees.company",            name: "LVC FairJob: Company Verification",            type: "one_time",  inrPaise: 999900,   usdCents: 29900 },
  { key: "verificationFees.university",         name: "LVC FairJob: University Verification",         type: "one_time",  inrPaise: 1999900,  usdCents: 49900 },
  { key: "verificationFees.sales_champion",     name: "LVC FairJob: Sales Champion Verification",     type: "one_time",  inrPaise: 499900,   usdCents: 12900 },

  // ── Job Seeker Subscriptions ──────────────────────────────────────────────
  { key: "subscriptions.job_seeker.basic",      name: "LVC FairJob: Job Seeker Basic",                type: "recurring", inrPaise: 39900,    usdCents: 900,   interval: "month" },
  { key: "subscriptions.job_seeker.standard",   name: "LVC FairJob: Job Seeker Standard",             type: "recurring", inrPaise: 79900,    usdCents: 1900,  interval: "month" },
  { key: "subscriptions.job_seeker.premium",    name: "LVC FairJob: Job Seeker Premium",              type: "recurring", inrPaise: 249900,   usdCents: 4900,  interval: "month" },

  // ── Company Subscriptions ─────────────────────────────────────────────────
  { key: "subscriptions.company.1_seat",        name: "LVC FairJob: Company 1 Seat",                  type: "recurring", inrPaise: 1000000,  usdCents: 19900, interval: "month" },
  { key: "subscriptions.company.2_seats",       name: "LVC FairJob: Company 2 Seats",                 type: "recurring", inrPaise: 1800000,  usdCents: 34900, interval: "month" },
  { key: "subscriptions.company.5_seats",       name: "LVC FairJob: Company 5 Seats",                 type: "recurring", inrPaise: 3000000,  usdCents: 59900, interval: "month" },
  { key: "subscriptions.company.10_seats",      name: "LVC FairJob: Company 10 Seats",                type: "recurring", inrPaise: 7500000,  usdCents: 149900,interval: "month" },
  { key: "subscriptions.company.25_seats",      name: "LVC FairJob: Company 25 Seats",                type: "recurring", inrPaise: 20000000, usdCents: 399900,interval: "month" },

  // ── Sales Champion Subscriptions ──────────────────────────────────────────
  { key: "subscriptions.sales_champion.tier_1", name: "LVC FairJob: Sales Champion Tier 1",           type: "recurring", inrPaise: 150000,   usdCents: 2900,  interval: "month" },
  { key: "subscriptions.sales_champion.tier_2", name: "LVC FairJob: Sales Champion Tier 2",           type: "recurring", inrPaise: 400000,   usdCents: 7900,  interval: "month" },
  { key: "subscriptions.sales_champion.tier_3", name: "LVC FairJob: Sales Champion Tier 3",           type: "recurring", inrPaise: 750000,   usdCents: 14900, interval: "month" },
  { key: "subscriptions.sales_champion.tier_4", name: "LVC FairJob: Sales Champion Tier 4",           type: "recurring", inrPaise: 1500000,  usdCents: 29900, interval: "month" },

  // ── Layoff Mode Subscriptions ─────────────────────────────────────────────
  { key: "subscriptions.layoff_mode.lite",      name: "LVC FairJob: Layoff Mode Lite",                type: "recurring", inrPaise: 75000,    usdCents: 1500,  interval: "month" },
  { key: "subscriptions.layoff_mode.plus",      name: "LVC FairJob: Layoff Mode Plus",                type: "recurring", inrPaise: 200000,   usdCents: 3900,  interval: "month" },
  { key: "subscriptions.layoff_mode.max",       name: "LVC FairJob: Layoff Mode Max",                 type: "recurring", inrPaise: 400000,   usdCents: 7900,  interval: "month" },

  // ── Add-ons (one-time) ────────────────────────────────────────────────────
  { key: "addons.employment_verification",      name: "LVC FairJob: Employment Verification Add-on",  type: "one_time",  inrPaise: 199900,   usdCents: 4900  },
  { key: "addons.profile_boost",                name: "LVC FairJob: Profile Boost Add-on",            type: "one_time",  inrPaise: 39900,    usdCents: 1000  },
];

// ── Stripe helpers ────────────────────────────────────────────────────────────

/** Find existing Stripe product by our metadata key, or return null */
async function findExistingProduct(productKey: string): Promise<Stripe.Product | null> {
  const results = await stripe.products.search({
    query: `metadata['productKey']:'${productKey}'`,
    limit: 1,
  });
  return results.data[0] ?? null;
}

/** Find existing Stripe price for a product+currency, or return null */
async function findExistingPrice(
  productId: string,
  currency: string,
  type: "one_time" | "recurring"
): Promise<Stripe.Price | null> {
  const prices = await stripe.prices.list({
    product: productId,
    currency,
    active: true,
    limit: 10,
  });
  return prices.data.find(p => p.type === type) ?? null;
}

/** Create or reuse a Stripe product */
async function upsertProduct(def: ProductDef): Promise<Stripe.Product> {
  const existing = await findExistingProduct(def.key);
  if (existing) {
    console.log(`  ♻️  Reusing product: ${existing.id}  (${def.key})`);
    return existing;
  }
  const product = await stripe.products.create({
    name: def.name,
    metadata: { productKey: def.key },
  });
  console.log(`  ✅ Created product: ${product.id}  (${def.key})`);
  return product;
}

/** Create or reuse a Stripe price */
async function upsertPrice(
  productId: string,
  currency: string,
  amount: number,
  def: ProductDef
): Promise<Stripe.Price> {
  const existing = await findExistingPrice(productId, currency, def.type);
  if (existing && existing.unit_amount === amount) {
    console.log(`     ♻️  Reusing ${currency.toUpperCase()} price: ${existing.id}  (${amount} ${currency})`);
    return existing;
  }
  // Amount changed or doesn't exist — create new price
  // (Stripe prices are immutable; old one stays active until we archive it)
  const priceParams: Stripe.PriceCreateParams = {
    product: productId,
    currency,
    unit_amount: amount,
    metadata: { productKey: def.key },
    ...(def.type === "recurring"
      ? { recurring: { interval: def.interval ?? "month" } }
      : {}),
  };
  const price = await stripe.prices.create(priceParams);
  console.log(`     ✅ Created ${currency.toUpperCase()} price: ${price.id}  (${amount} ${currency})`);

  // Archive old price if it existed with a different amount
  if (existing) {
    await stripe.prices.update(existing.id, { active: false });
    console.log(`     🗑️  Archived old ${currency.toUpperCase()} price: ${existing.id}`);
  }

  return price;
}

// ── Result map ────────────────────────────────────────────────────────────────
interface StripeIds {
  stripeProductId: string;
  stripePriceId_inr: string;
  stripePriceId_usd: string;
}

async function syncAllToStripe(): Promise<Record<string, StripeIds>> {
  const result: Record<string, StripeIds> = {};

  for (const def of PRODUCTS) {
    console.log(`\n📦 ${def.name}`);
    const product = await upsertProduct(def);
    const inrPrice = await upsertPrice(product.id, "inr", def.inrPaise, def);
    const usdPrice = await upsertPrice(product.id, "usd", def.usdCents, def);

    result[def.key] = {
      stripeProductId: product.id,
      stripePriceId_inr: inrPrice.id,
      stripePriceId_usd: usdPrice.id,
    };
  }

  return result;
}

// ── Build Firestore payload ───────────────────────────────────────────────────
function buildFirestorePayload(ids: Record<string, StripeIds>) {
  const g = (key: string) => ids[key] ?? {};

  return {
    verificationFees: {
      job_seeker: {
        india:  { max: 99900,    currency: "INR", symbol: "₹", price_inr: 99900,    ...g("verificationFees.job_seeker"),         benefits: ["Verified badge on your profile","Priority visibility to recruiters","Access to premium job listings","One-time KYC verification included","Trust score boost across the platform"] },
        global: { max: 2000,     currency: "USD", symbol: "$", price_usd: 2000,     ...g("verificationFees.job_seeker"),         benefits: ["Verified badge on your profile","Priority visibility to recruiters","Access to premium job listings","One-time KYC verification included","Trust score boost across the platform"] },
      },
      student_job_seeker: {
        india:  { max: 39900,    currency: "INR", symbol: "₹", price_inr: 39900,    ...g("verificationFees.student_job_seeker"), benefits: ["Student-verified badge on your profile","Access to campus & internship listings","Discounted one-time verification fee","Eligibility for student-exclusive opportunities","Trust score activation"] },
        global: { max: 1000,     currency: "USD", symbol: "$", price_usd: 1000,     ...g("verificationFees.student_job_seeker"), benefits: ["Student-verified badge on your profile","Access to campus & internship listings","Discounted one-time verification fee","Eligibility for student-exclusive opportunities","Trust score activation"] },
      },
      recruiter: {
        india:  { max: 399900,   currency: "INR", symbol: "₹", price_inr: 399900,   ...g("verificationFees.recruiter"),          benefits: ["Recruiter-verified badge","Post up to 10 active job listings","Access to verified candidate pool","AI-assisted candidate matching","Priority listing placement"] },
        global: { max: 9900,     currency: "USD", symbol: "$", price_usd: 9900,     ...g("verificationFees.recruiter"),          benefits: ["Recruiter-verified badge","Post up to 10 active job listings","Access to verified candidate pool","AI-assisted candidate matching","Priority listing placement"] },
      },
      company: {
        india:  { max: 999900,   currency: "INR", symbol: "₹", price_inr: 999900,   ...g("verificationFees.company"),            benefits: ["Company-verified seal on all listings","Unlimited job postings during review period","Access to the full candidate marketplace","Fraud protection and compliance check","Priority support from verification team"] },
        global: { max: 29900,    currency: "USD", symbol: "$", price_usd: 29900,    ...g("verificationFees.company"),            benefits: ["Company-verified seal on all listings","Unlimited job postings during review period","Access to the full candidate marketplace","Fraud protection and compliance check","Priority support from verification team"] },
      },
      university: {
        india:  { max: 1999900,  currency: "INR", symbol: "₹", price_inr: 1999900,  ...g("verificationFees.university"),         benefits: ["University-verified institution badge","Dedicated campus recruitment portal","Access to all student & alumni profiles","Partnership co-branding on the platform","Compliance and accreditation review included"] },
        global: { max: 49900,    currency: "USD", symbol: "$", price_usd: 49900,    ...g("verificationFees.university"),         benefits: ["University-verified institution badge","Dedicated campus recruitment portal","Access to all student & alumni profiles","Partnership co-branding on the platform","Compliance and accreditation review included"] },
      },
      sales_champion: {
        india:  { max: 499900,   currency: "INR", symbol: "₹", price_inr: 499900,   ...g("verificationFees.sales_champion"),     benefits: ["Sales Champion verified badge","Access to referral commission dashboard","Priority lead assignment","Dedicated onboarding support","Performance-based tier upgrades"] },
        global: { max: 12900,    currency: "USD", symbol: "$", price_usd: 12900,    ...g("verificationFees.sales_champion"),     benefits: ["Sales Champion verified badge","Access to referral commission dashboard","Priority lead assignment","Dedicated onboarding support","Performance-based tier upgrades"] },
      },
    },

    subscriptions: {
      job_seeker: {
        basic:    { india: 39900,    global: 900,    price_inr: 39900,    price_usd: 900,    ...g("subscriptions.job_seeker.basic"),      benefits: ["Apply to up to 20 jobs per month","Basic profile visibility","Access to standard job listings","Email job alerts"] },
        standard: { india: 79900,    global: 1900,   price_inr: 79900,    price_usd: 1900,   ...g("subscriptions.job_seeker.standard"),   benefits: ["Apply to up to 60 jobs per month","Enhanced profile ranking in searches","Access to premium job listings","Resume builder tool","Priority email support"] },
        premium:  { india: 249900,   global: 4900,   price_inr: 249900,   price_usd: 4900,   ...g("subscriptions.job_seeker.premium"),    benefits: ["Unlimited job applications","Top placement in recruiter searches","Access to all job listings including hidden","AI-powered resume optimization","1-on-1 career advisor session per month","Interview preparation resources"] },
      },
      company: {
        "1_seat":   { india: 1000000,  global: 19900,  price_inr: 1000000,  price_usd: 19900,  seats: 1,  ...g("subscriptions.company.1_seat"),   benefits: ["1 active recruiter seat","Post up to 5 job listings","Access to candidate search","Basic analytics dashboard"] },
        "2_seats":  { india: 1800000,  global: 34900,  price_inr: 1800000,  price_usd: 34900,  seats: 2,  ...g("subscriptions.company.2_seats"),  benefits: ["2 active recruiter seats","Post up to 12 job listings","Candidate search & shortlisting","Team collaboration tools","Standard analytics"] },
        "5_seats":  { india: 3000000,  global: 59900,  price_inr: 3000000,  price_usd: 59900,  seats: 5,  ...g("subscriptions.company.5_seats"),  benefits: ["5 active recruiter seats","Post up to 30 job listings","Advanced candidate search filters","Team collaboration & notes","Enhanced analytics & reporting","Priority candidate matching"] },
        "10_seats": { india: 7500000,  global: 149900, price_inr: 7500000,  price_usd: 149900, seats: 10, ...g("subscriptions.company.10_seats"), benefits: ["10 active recruiter seats","Unlimited job postings","Full candidate marketplace access","ATS integration support","Advanced analytics & export","Dedicated account manager"] },
        "25_seats": { india: 20000000, global: 399900, price_inr: 20000000, price_usd: 399900, seats: 25, ...g("subscriptions.company.25_seats"), benefits: ["25 active recruiter seats","Unlimited job postings","Enterprise-grade candidate pipeline","Custom ATS & HRIS integration","SLA-backed support","Quarterly business reviews","Custom branding on listings"] },
      },
      sales_champion: {
        tier_1: { india: 150000,  global: 2900,  price_inr: 150000,  price_usd: 2900,  ...g("subscriptions.sales_champion.tier_1"), benefits: ["Up to 10 referral leads per month","5% commission on successful placements","Basic referral tracking dashboard","Monthly performance report"] },
        tier_2: { india: 400000,  global: 7900,  price_inr: 400000,  price_usd: 7900,  ...g("subscriptions.sales_champion.tier_2"), benefits: ["Up to 30 referral leads per month","8% commission on successful placements","Advanced referral tracking dashboard","Bi-weekly performance coaching","Priority lead queue"] },
        tier_3: { india: 750000,  global: 14900, price_inr: 750000,  price_usd: 14900, ...g("subscriptions.sales_champion.tier_3"), benefits: ["Up to 75 referral leads per month","12% commission on successful placements","Full CRM-style lead management","Weekly coaching calls","Dedicated referral portal","Bonus incentives on milestones"] },
        tier_4: { india: 1500000, global: 29900, price_inr: 1500000, price_usd: 29900, ...g("subscriptions.sales_champion.tier_4"), benefits: ["Unlimited referral leads","15% commission on successful placements","Enterprise lead management suite","Personal success manager","Top-tier performance bonuses","Early access to new platform features","Co-branded marketing materials"] },
      },
      layoff_mode: {
        lite: { india: 75000,  global: 1500, price_inr: 75000,  price_usd: 1500, ...g("subscriptions.layoff_mode.lite"), benefits: ["Layoff support profile badge","Access to layoff-friendly job listings","Basic resume review","Community forum access"] },
        plus: { india: 200000, global: 3900, price_inr: 200000, price_usd: 3900, ...g("subscriptions.layoff_mode.plus"), benefits: ["Layoff support profile badge","Priority placement in layoff job pool","1 professional resume rewrite per month","Career counsellor session (30 min)","LinkedIn profile tips"] },
        max:  { india: 400000, global: 7900, price_inr: 400000, price_usd: 7900, ...g("subscriptions.layoff_mode.max"),  benefits: ["Layoff support profile badge","Top-priority job matching","Unlimited resume revisions","Weekly 1-on-1 career coaching","Interview prep & mock sessions","Networking introductions to hiring managers","Mental wellness resources & community"] },
      },
    },

    addons: {
      employment_verification: { india: 199900, global: 4900, price_inr: 199900, price_usd: 4900, ...g("addons.employment_verification"), benefits: ["Verified employment history record","Powered by Truework / The Work Number","Instant digital certificate","Accepted by top employers worldwide"] },
      profile_boost:           { india: 39900,  global: 1000, price_inr: 39900,  price_usd: 1000, ...g("addons.profile_boost"),           benefits: ["7-day profile spotlight in recruiter searches","3× visibility boost on job applications","Featured badge during boost period","Performance report at end of boost"] },
    },

    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: "seed-pricing-with-stripe",
    stripeMode: "test",
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function seed() {
  console.log(`\n🚀 Starting Stripe + Firestore pricing seed`);
  console.log(`   Firebase project : ${projectId}`);
  console.log(`   Stripe mode      : TEST`);
  console.log(`   Products to sync : ${PRODUCTS.length}\n`);

  // Step 1: Sync all products/prices to Stripe test
  console.log("━━━ Step 1: Syncing to Stripe (test mode) ━━━");
  const stripeIds = await syncAllToStripe();

  // Step 2: Print summary
  console.log("\n━━━ Stripe IDs Summary ━━━");
  for (const [key, ids] of Object.entries(stripeIds)) {
    console.log(`\n  ${key}`);
    console.log(`    Product : ${ids.stripeProductId}`);
    console.log(`    INR     : ${ids.stripePriceId_inr}`);
    console.log(`    USD     : ${ids.stripePriceId_usd}`);
  }

  // Step 3: Write to Firestore dev DB
  console.log("\n━━━ Step 2: Writing to Firestore ━━━");
  const payload = buildFirestorePayload(stripeIds);
  await db.doc(PRICING_CONFIG_PATH).set(payload);
  console.log(`✅ Firestore updated at: ${PRICING_CONFIG_PATH}`);

  console.log("\n🎉 Done! All products, prices, and Firestore pricing config are in sync.\n");
  process.exit(0);
}

seed().catch((err) => {
  console.error("❌ Seed failed:", err.message || err);
  process.exit(1);
});
