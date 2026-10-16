-- =============================================================================
-- 034_overview_activity_covering_key.sql
-- =============================================================================
-- Speeds up the overview page's 7- and 30-day ranges (033). The primary key
-- of cw_device_activity_hourly becomes (dev_eui, hour) INCLUDE (uplinks), so
-- cw_overview reads the uplink counts straight from the index (an index-only
-- scan) instead of fetching every matching row from the table. Measured on
-- prod on 2026-10-15 for all 204 devices over 30 days: 202 ms in total, of
-- which 125 ms was fetching those 122k rows.
--
-- Nothing else changes: uniqueness is still on (dev_eui, hour) (INCLUDE
-- columns are stored in the index but are not part of the key), so the
-- ON CONFLICT (dev_eui, hour) upsert in cw_device_activity_recompute and the
-- foreign key to cw_devices work as before.
--
-- HOW TO RUN (SQL editor, as postgres): the whole file. Rebuilding the key
-- locks only this table, for well under a second (~125k narrow rows); only
-- the 10-minute tick and the overview page use it. Rerunnable (it rebuilds
-- the key again). Verification and rollback: bottom of file.
-- =============================================================================

BEGIN;

-- If a tick holds the table, wait at most 5 s, then fail: just rerun.
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.cw_device_activity_hourly
  DROP CONSTRAINT IF EXISTS cw_device_activity_hourly_pkey;
ALTER TABLE public.cw_device_activity_hourly
  ADD CONSTRAINT cw_device_activity_hourly_pkey PRIMARY KEY (dev_eui, hour) INCLUDE (uplinks);

COMMIT;

-- =============================================================================
-- OPS — verification (read-only)
-- =============================================================================
-- SELECT pg_get_indexdef('public.cw_device_activity_hourly_pkey'::regclass);
-- -- expect: ... USING btree (dev_eui, hour) INCLUDE (uplinks)
-- -- Every device, 30 days (the heaviest call): expect well under 100 ms.
-- EXPLAIN (ANALYZE)
-- SELECT public.cw_overview(ARRAY(SELECT dev_eui::text FROM public.cw_devices), 720, 20);

-- =============================================================================
-- ROLLBACK (back to 033's key; nothing else depends on the INCLUDE)
-- =============================================================================
-- BEGIN;
-- SET LOCAL lock_timeout = '5s';
-- ALTER TABLE public.cw_device_activity_hourly DROP CONSTRAINT cw_device_activity_hourly_pkey;
-- ALTER TABLE public.cw_device_activity_hourly ADD CONSTRAINT cw_device_activity_hourly_pkey PRIMARY KEY (dev_eui, hour);
-- COMMIT;
