-- 015_stripe_billing.sql
-- =============================================================================
-- Migrate billing from Polar to Stripe.
--
-- Renames the provider-specific id columns and clears any Polar-era cached
-- state. Safe to run destructively: production Polar had zero customers and
-- zero subscriptions at migration time (verified 2026-07-11), so every row in
-- these tables is a sandbox/testing stray.
--
-- Stripe remains the source of truth for subscription state; these tables are
-- a cache plus the CropWatch-owned license<->device mapping, exactly as under
-- Polar (see 010_polar_device_licenses.sql).
-- =============================================================================

BEGIN;

ALTER TABLE public.billing_customers
  RENAME COLUMN polar_customer_id TO stripe_customer_id;

ALTER TABLE public.device_licenses
  RENAME COLUMN polar_subscription_id TO stripe_subscription_id;

COMMENT ON COLUMN public.billing_customers.stripe_customer_id IS
  'Stripe customer id (cus_...). Created lazily on first billing action.';
COMMENT ON COLUMN public.device_licenses.stripe_subscription_id IS
  'Stripe subscription id (sub_...) of the device-seat subscription.';

-- Clear Polar-era cached state / sandbox strays.
UPDATE public.billing_customers
   SET stripe_customer_id = NULL,
       base_subscription_id = NULL,
       base_status = NULL,
       base_discount_id = NULL,
       device_subscription_id = NULL,
       device_seats = 0;

DELETE FROM public.device_licenses;

COMMIT;
