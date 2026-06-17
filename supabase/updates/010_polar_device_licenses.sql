-- =============================================================================
-- 010_polar_device_licenses.sql
-- Polar.sh subscription + device-licensing feature.
--
-- Replaces the removed Stripe billing with Polar. Two new tables:
--
--  A) billing_customers — links a Supabase user (profiles.id) to their Polar
--     customer and caches the Base Subscription + Device Subscription state.
--     Kept separate from `profiles` on purpose: `profiles` is joined into
--     device/location reads everywhere, and billing should not widen those
--     selects or couple identity to billing.
--
--  B) device_licenses — the license <-> device assignment. This is a
--     CropWatch-owned concept; Polar has no notion of a dev_eui. Polar is the
--     source of truth for HOW MANY licenses (seats) a user pays for; this
--     table is the source of truth for WHICH device each seat is assigned to.
--
-- Seat reconciliation invariant (enforced by the API webhook handler, not the
-- DB): a user's device_licenses row count == the Polar device-subscription
-- seat count, EXCEPT that an assigned row is never destroyed when seats
-- decrease — the API blocks decreases below the assigned count, and the
-- webhook only ever deletes UNASSIGNED rows.
--
-- RLS is enabled with no anon/authenticated policies, matching the posture of
-- 002_enable_rls_all_public.sql: the API uses the service-role client and
-- enforces authorization in Nest.
--
-- Idempotent: CREATE ... IF NOT EXISTS throughout.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- A) billing_customers — Supabase user <-> Polar customer + cached state
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.billing_customers (
  user_id                uuid        PRIMARY KEY
                                     REFERENCES public.profiles (id) ON DELETE CASCADE,
  polar_customer_id      text        UNIQUE,
  base_subscription_id   text,
  base_status            text,           -- cache: active | trialing | past_due | canceled | null
  base_discount_id       text,           -- cache of the applied Polar discount, if any
  device_subscription_id text,
  device_seats           integer     NOT NULL DEFAULT 0,  -- cache; Polar is source of truth
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.billing_customers ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- B) device_licenses — one row per owned seat; dev_eui null => unassigned
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.device_licenses (
  id                    bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id               uuid        NOT NULL
                                    REFERENCES public.profiles (id) ON DELETE CASCADE,
  polar_subscription_id text        NOT NULL,
  seat_index            integer     NOT NULL,            -- stable 0-based ordinal per user
  dev_eui               text        REFERENCES public.cw_devices (dev_eui) ON DELETE SET NULL,
  status                text        NOT NULL DEFAULT 'unassigned',  -- 'assigned' | 'unassigned'
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT device_licenses_user_seat_unique UNIQUE (user_id, seat_index)
);

-- A device can hold at most one license.
CREATE UNIQUE INDEX IF NOT EXISTS device_licenses_dev_eui_unique
  ON public.device_licenses (dev_eui)
  WHERE dev_eui IS NOT NULL;

-- Hot-path lookups: a user's licenses, and a device's license.
CREATE INDEX IF NOT EXISTS idx_device_licenses_user_id
  ON public.device_licenses (user_id);
CREATE INDEX IF NOT EXISTS idx_device_licenses_dev_eui
  ON public.device_licenses (dev_eui)
  WHERE dev_eui IS NOT NULL;

ALTER TABLE public.device_licenses ENABLE ROW LEVEL SECURITY;

COMMIT;
