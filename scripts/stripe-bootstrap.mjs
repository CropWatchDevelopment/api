// Idempotent Stripe product/price bootstrap for CropWatch billing.
//
// Creates the Device Subscription (per-seat, minimum 3 seats) and Reporting
// add-on (flat monthly) products with the lookup keys the API resolves at
// runtime (see src/v1/payments/stripe.service.ts). Safe to re-run: existing
// prices are found by lookup key and left untouched.
//
// Amounts/currency are read from the environment so the same script serves
// test and live mode. A Stripe price's currency and amount cannot be edited
// after creation — to change pricing later, create a new price in the
// dashboard and transfer the lookup key to it.
//
//   STRIPE_BOOTSTRAP_CURRENCY          default 'jpy' (zero-decimal: 800 = ¥800)
//   STRIPE_BOOTSTRAP_SEAT_AMOUNT       default 800    (per seat, per month)
//   STRIPE_BOOTSTRAP_REPORTING_AMOUNT  default 4000   (flat, per month)
//   STRIPE_BOOTSTRAP_TAX_BEHAVIOR      default 'inclusive'
//
// Run against whichever mode the key in STRIPE_SECRET_KEY selects:
//   node --env-file=.env scripts/stripe-bootstrap.mjs
import Stripe from 'stripe';

const DEVICE_LOOKUP_KEY = 'cropwatch_device_seat_monthly';
const REPORTING_LOOKUP_KEY = 'cropwatch_reporting_monthly';
const SEAT_MINIMUM = 3; // mirrors SEAT_MINIMUM in src/v1/payments/payments.types.ts

const secretKey = process.env.STRIPE_SECRET_KEY;
if (!secretKey) {
  console.error(
    'STRIPE_SECRET_KEY is not set. Run with: node --env-file=.env scripts/stripe-bootstrap.mjs',
  );
  process.exit(1);
}
const mode = secretKey.startsWith('sk_live_') ? 'LIVE' : 'test';
const stripe = new Stripe(secretKey);

const currency = (process.env.STRIPE_BOOTSTRAP_CURRENCY ?? 'jpy').toLowerCase();
const seatAmount = Number.parseInt(
  process.env.STRIPE_BOOTSTRAP_SEAT_AMOUNT ?? '800',
  10,
);
const reportingAmount = Number.parseInt(
  process.env.STRIPE_BOOTSTRAP_REPORTING_AMOUNT ?? '4000',
  10,
);
const taxBehavior = process.env.STRIPE_BOOTSTRAP_TAX_BEHAVIOR ?? 'inclusive';
if (!Number.isInteger(seatAmount) || !Number.isInteger(reportingAmount)) {
  console.error(
    'STRIPE_BOOTSTRAP_*_AMOUNT must be integers in the smallest currency unit.',
  );
  process.exit(1);
}

/** Find an active recurring price by lookup key, or create product + price. */
async function ensurePrice({
  lookupKey,
  productName,
  description,
  unitAmount,
}) {
  const existing = await stripe.prices.list({
    lookup_keys: [lookupKey],
    active: true,
  });
  if (existing.data.length > 0) {
    const price = existing.data[0];
    console.log(
      `✓ ${lookupKey} already exists: ${price.id} (product ${price.product}, ${price.unit_amount} ${price.currency}/${price.recurring?.interval})`,
    );
    return price;
  }

  const product = await stripe.products.create({
    name: productName,
    description,
  });
  const price = await stripe.prices.create({
    product: product.id,
    lookup_key: lookupKey,
    currency,
    unit_amount: unitAmount,
    recurring: { interval: 'month' },
    // Default: prices are tax-inclusive; JCT accounting is handled outside Stripe.
    tax_behavior: taxBehavior,
  });
  console.log(
    `+ created ${lookupKey}: ${price.id} (product ${product.id}, ${unitAmount} ${currency}/month)`,
  );
  return price;
}

console.log(`Bootstrapping CropWatch billing products in ${mode} mode…`);
console.log(
  `  currency=${currency} seat=${seatAmount} reporting=${reportingAmount} tax_behavior=${taxBehavior}`,
);
if (mode === 'LIVE') {
  console.log(
    '  !! LIVE mode: double-check the amounts above — prices cannot be edited later.',
  );
}

const device = await ensurePrice({
  lookupKey: DEVICE_LOOKUP_KEY,
  productName: 'Device Subscription',
  description: `Per-device license. One seat = one device license (minimum ${SEAT_MINIMUM} seats). Assign licenses to devices in CropWatch.`,
  unitAmount: seatAmount,
});

const reporting = await ensurePrice({
  lookupKey: REPORTING_LOOKUP_KEY,
  productName: 'Reporting Package',
  description:
    'Scheduled PDF/email reports for every device on the account. One flat monthly add-on.',
  unitAmount: reportingAmount,
});

console.log('\nDone. The API resolves these automatically by lookup key —');
console.log(
  'no STRIPE_DEVICE_PRICE_ID / STRIPE_REPORTING_PRICE_ID env vars needed.',
);
console.log(`  device:    ${device.id}`);
console.log(`  reporting: ${reporting.id}`);
console.log(
  `\nThe minimum seat count (${SEAT_MINIMUM}) is enforced by the API and the hosted checkout, not by the price.`,
);
