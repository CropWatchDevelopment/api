-- 024_billing_seats_v2.sql
-- =============================================================================
-- Billing v2: seats-only subscriptions (minimum 3 seats), manual-invoice
-- customers, and the reporting add-on.
--
--  A) billing_customers.billing_mode   'stripe' (self-serve) | 'manual'
--     (invoiced outside Stripe; seats granted by staff)
--  B) billing_customers.reporting_*    cache of the reporting add-on
--     subscription + a staff-granted reporting flag
--  C) device_licenses.stripe_subscription_id becomes nullable —
--     NULL = a seat granted by staff (never touched by Stripe reconciliation)
--  D) device_licenses.dev_eui FK gains ON UPDATE CASCADE so a licensed
--     device keeps its license when replaceDevice renames its dev_eui
--
-- The base-subscription columns (base_subscription_id / base_status /
-- base_discount_id) are no longer written after this release; they are kept
-- for now and dropped in a later script.
--
-- Additive and idempotent. Regenerate / patch database.types.ts (api) after.
-- =============================================================================

BEGIN;

-- A) billing mode -------------------------------------------------------------
ALTER TABLE public.billing_customers
  ADD COLUMN IF NOT EXISTS billing_mode text NOT NULL DEFAULT 'stripe';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'billing_customers_billing_mode_check'
       AND conrelid = 'public.billing_customers'::regclass
  ) THEN
    ALTER TABLE public.billing_customers
      ADD CONSTRAINT billing_customers_billing_mode_check
      CHECK (billing_mode IN ('stripe', 'manual'));
  END IF;
END $$;

COMMENT ON COLUMN public.billing_customers.billing_mode IS
  'stripe = self-serve via Stripe Checkout; manual = invoiced outside Stripe, seats granted by staff (device_licenses.stripe_subscription_id IS NULL).';

-- B) reporting add-on ---------------------------------------------------------
ALTER TABLE public.billing_customers
  ADD COLUMN IF NOT EXISTS reporting_subscription_id text,
  ADD COLUMN IF NOT EXISTS reporting_status          text,
  ADD COLUMN IF NOT EXISTS reporting_manual          boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.billing_customers.reporting_subscription_id IS
  'Stripe subscription id (sub_...) of the reporting add-on. Stripe is the source of truth.';
COMMENT ON COLUMN public.billing_customers.reporting_status IS
  'Cached Stripe status of the reporting add-on (active|trialing|past_due|canceled|null).';
COMMENT ON COLUMN public.billing_customers.reporting_manual IS
  'Staff-granted reporting entitlement (manual-invoice or comped customers). Overrides the Stripe status.';

-- C) staff-granted seats ------------------------------------------------------
ALTER TABLE public.device_licenses
  ALTER COLUMN stripe_subscription_id DROP NOT NULL;

COMMENT ON COLUMN public.device_licenses.stripe_subscription_id IS
  'Stripe subscription id (sub_...) of the device-seat subscription; NULL for seats granted by staff. Stripe reconciliation never counts or deletes NULL rows.';

-- D) license follows a dev_eui rename ----------------------------------------
ALTER TABLE public.device_licenses
  DROP CONSTRAINT IF EXISTS device_licenses_dev_eui_fkey;

ALTER TABLE public.device_licenses
  ADD CONSTRAINT device_licenses_dev_eui_fkey
  FOREIGN KEY (dev_eui) REFERENCES public.cw_devices (dev_eui)
  ON UPDATE CASCADE ON DELETE SET NULL;

COMMIT;

-- =============================================================================
-- OPS — run ONCE on production, after the API release is deployed.
-- Clears the TEST-mode Stripe ids (dev account) that leaked into the
-- production tables during the 2026-07-18 checkout verification. Live keys
-- do not know these ids. Verify the user id before running.
-- =============================================================================
-- BEGIN;
-- DELETE FROM public.device_licenses
--  WHERE user_id = 'fd140e81-7640-4f42-ab52-dff1b5635723'
--    AND stripe_subscription_id LIKE 'sub_%';
-- UPDATE public.billing_customers
--    SET stripe_customer_id = NULL,
--        base_subscription_id = NULL,
--        base_status = NULL,
--        base_discount_id = NULL,
--        device_subscription_id = NULL,
--        device_seats = 0,
--        updated_at = now()
--  WHERE user_id = 'fd140e81-7640-4f42-ab52-dff1b5635723';
-- COMMIT;
