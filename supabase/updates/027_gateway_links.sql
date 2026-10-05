-- 027_gateway_links.sql
-- =============================================================================
-- Gateway status + device/gateway links.
--
--  A) cw_gateways status columns:
--       last_seen_at       — newest uplink heard through this gateway
--                            (written by cw-data-handler-ts, gateway.seen queue)
--       status_checked_at  — last time cw-gateway-status checked TTI
--       connected_at       — TTI Gateway Server connected_at (NULL = offline)
--  B) cw_device_gateway — drop the gateway_id FK. Devices are heard by
--     foreign / unregistered / Packet Broker gateways that will never have a
--     cw_gateways row; the FK would reject every one of those sightings.
--     The table stays bounded: one upserted row per (dev_eui, gateway_id).
--
-- Additive and idempotent. Run BEFORE deploying the gateway-links API and
-- BEFORE the data handler starts consuming gateway.seen. Patch
-- database.types.ts (api + CropWatch) after.
-- =============================================================================

BEGIN;

-- A) status columns --------------------------------------------------------------
ALTER TABLE public.cw_gateways
  ADD COLUMN IF NOT EXISTS last_seen_at      timestamptz,
  ADD COLUMN IF NOT EXISTS status_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS connected_at      timestamptz;

COMMENT ON COLUMN public.cw_gateways.last_seen_at IS
  'Newest uplink received through this gateway (027, data handler).';
COMMENT ON COLUMN public.cw_gateways.status_checked_at IS
  'Last TTI connection-stats check (027, cw-gateway-status).';
COMMENT ON COLUMN public.cw_gateways.connected_at IS
  'TTI Gateway Server connected_at; NULL while offline (027, cw-gateway-status).';

-- B) cw_device_gateway -----------------------------------------------------------
ALTER TABLE public.cw_device_gateway
  DROP CONSTRAINT IF EXISTS cw_device_gateway_gateway_id_fkey;

CREATE INDEX IF NOT EXISTS cw_device_gateway_gateway_last_update_idx
  ON public.cw_device_gateway (gateway_id, last_update DESC);

COMMIT;

-- =============================================================================
-- OPS — verify
-- =============================================================================
-- SELECT
--   (SELECT COUNT(*) FROM public.cw_device_gateway)                     AS device_gateway_rows,
--   (SELECT COUNT(*) FROM public.cw_gateways WHERE last_seen_at IS NOT NULL) AS gateways_seen;
--
-- =============================================================================
-- ROLLBACK (only before any foreign-gateway sightings have been written —
-- re-adding the FK fails otherwise)
-- =============================================================================
-- DROP INDEX IF EXISTS public.cw_device_gateway_gateway_last_update_idx;
-- ALTER TABLE public.cw_gateways
--   DROP COLUMN IF EXISTS last_seen_at,
--   DROP COLUMN IF EXISTS status_checked_at,
--   DROP COLUMN IF EXISTS connected_at;
-- ALTER TABLE public.cw_device_gateway
--   ADD CONSTRAINT cw_device_gateway_gateway_id_fkey FOREIGN KEY (gateway_id)
--   REFERENCES public.cw_gateways (gateway_id) ON UPDATE CASCADE ON DELETE CASCADE;
