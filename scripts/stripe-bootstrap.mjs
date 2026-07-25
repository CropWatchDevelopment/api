// Idempotent Stripe product/price bootstrap for CropWatch billing.
//
// Creates the Base Subscription (¥15,000/mo) and Device Subscription
// (¥800/seat/mo) products with the lookup keys the API resolves at runtime
// (see src/v1/payments/stripe.service.ts). Safe to re-run: existing prices
// are found by lookup key and left untouched.
//
// Run against whichever mode the key in STRIPE_SECRET_KEY selects:
//   node --env-file=.env scripts/stripe-bootstrap.mjs
import Stripe from 'stripe';

const BASE_LOOKUP_KEY = 'cropwatch_base_monthly';
const DEVICE_LOOKUP_KEY = 'cropwatch_device_seat_monthly';

const secretKey = process.env.STRIPE_SECRET_KEY;
if (!secretKey) {
  console.error(
    'STRIPE_SECRET_KEY is not set. Run with: node --env-file=.env scripts/stripe-bootstrap.mjs',
  );
  process.exit(1);
}
const mode = secretKey.startsWith('sk_live_') ? 'LIVE' : 'test';
const stripe = new Stripe(secretKey);

/** Find an active recurring price by lookup key, or create product + price. */
async function ensurePrice({ lookupKey, productName, description, unitAmount }) {
  const existing = await stripe.prices.list({
    lookup_keys: [lookupKey],
    active: true,
  });
  if (existing.data.length > 0) {
    const price = existing.data[0];
    console.log(`✓ ${lookupKey} already exists: ${price.id} (product ${price.product})`);
    return price;
  }

  const product = await stripe.products.create({
    name: productName,
    description,
  });
  const price = await stripe.prices.create({
    product: product.id,
    lookup_key: lookupKey,
    currency: 'jpy', // zero-decimal: unit_amount 15000 = ¥15,000
    unit_amount: unitAmount,
    recurring: { interval: 'month' },
    // Prices are tax-inclusive; JCT accounting is handled outside Stripe.
    tax_behavior: 'inclusive',
  });
  console.log(`+ created ${lookupKey}: ${price.id} (product ${product.id})`);
  return price;
}

console.log(`Bootstrapping CropWatch billing products in ${mode} mode…`);

const base = await ensurePrice({
  lookupKey: BASE_LOOKUP_KEY,
  productName: 'Base Subscription',
  description:
    'Required CropWatch account subscription. Every account needs one active base subscription.',
  unitAmount: 15000,
});

const device = await ensurePrice({
  lookupKey: DEVICE_LOOKUP_KEY,
  productName: 'Device Subscription',
  description:
    'Per-device license. One seat = one device license. Assign licenses to devices in CropWatch.',
  unitAmount: 800,
});

console.log('\nDone. The API resolves these automatically by lookup key —');
console.log('no STRIPE_BASE_PRICE_ID / STRIPE_DEVICE_PRICE_ID env vars needed.');
console.log(`  base:   ${base.id}`);
console.log(`  device: ${device.id}`);
