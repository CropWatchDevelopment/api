-- =============================================================================
-- 007_indexes_and_keys.sql
-- Performance cleanup flagged by the Supabase performance advisor.
--
--  A) Drop 5 duplicate indexes (lint 0009_duplicate_index) — each pair is
--     byte-identical coverage; keeping one halves write amplification.
--  B) Add indexes on foreign keys that back hot API query patterns
--     (permission scoping joins on cw_device_owners / cw_location_owners and
--     device-by-location lookups). The advisor lists 36 unindexed FKs; most
--     are on cold/legacy tables and are NOT worth the write cost — only the
--     ones used by real query paths are added here.
--  C) (Commented) primary key for cw_air_alerts, which has none.
--
-- NOTE ON CREATE INDEX: plain CREATE INDEX takes a write lock on the table.
-- The tables below are small ACL/metadata tables (≈ 1k rows), so plain
-- CREATE INDEX inside the transaction is fine. If you prefer zero locking,
-- run the CONCURRENTLY variants listed at the bottom one-by-one OUTSIDE a
-- transaction instead of this BEGIN/COMMIT block.
--
-- Idempotent: DROP INDEX IF EXISTS / CREATE INDEX IF NOT EXISTS.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- A) Duplicate indexes — keep the first of each pair, drop the second.
-- ---------------------------------------------------------------------------
-- cw_air_alerts: keep cw_air_alerts_triggering_rule_group_key
DROP INDEX IF EXISTS public.cw_air_alerts_triggering_rule_group_key1;

-- cw_device_owners: keep cw_device_owners_dev_eui_idx
DROP INDEX IF EXISTS public.idx_cdo_dev_eui;

-- cw_device_owners: keep idx_cw_device_owners_dev_user_perm
DROP INDEX IF EXISTS public.idx_cdo_dev_eui_user_pl;

-- cw_devices: keep idx_cw_devices_location_id
DROP INDEX IF EXISTS public.idx_cw_devices_location;

-- report_user_schedule: keep the primary key, drop the redundant unique index
DROP INDEX IF EXISTS public.report_user_schedule_id_key;

-- Unused index flagged by the advisor on a permission column that is always
-- queried together with (dev_eui, user_id) — covered by
-- idx_cw_device_owners_dev_user_perm.
DROP INDEX IF EXISTS public.cw_device_owners_permission_level_idx;

-- ---------------------------------------------------------------------------
-- B) FK indexes that back real API query patterns
-- ---------------------------------------------------------------------------
-- Permission scoping: every device read/manage query joins
-- cw_device_owners on (dev_eui, user_id, permission_level) — already covered
-- by idx_cw_device_owners_dev_user_perm — plus per-user listings:
CREATE INDEX IF NOT EXISTS idx_cw_device_owners_user_id
    ON public.cw_device_owners (user_id);

-- Location permission scoping and "users in this location" listings:
CREATE INDEX IF NOT EXISTS idx_cw_location_owners_location_id
    ON public.cw_location_owners (location_id);
CREATE INDEX IF NOT EXISTS idx_cw_location_owners_user_id
    ON public.cw_location_owners (user_id);

-- Rule/report template fan-out (rules-new / reports-new modules):
CREATE INDEX IF NOT EXISTS idx_cw_device_rule_assignments_dev_eui
    ON public.cw_device_rule_assignments (dev_eui);
CREATE INDEX IF NOT EXISTS idx_cw_device_rule_assignments_template_id
    ON public.cw_device_rule_assignments (template_id);
CREATE INDEX IF NOT EXISTS idx_cw_device_report_assignments_dev_eui
    ON public.cw_device_report_assignments (dev_eui);

-- Triggered-rule history lookups (rules-new /triggered endpoints):
CREATE INDEX IF NOT EXISTS idx_cw_rule_trigger_log_template_id
    ON public.cw_rule_trigger_log (template_id);

COMMIT;

-- ---------------------------------------------------------------------------
-- C) OPTIONAL — cw_air_alerts has no primary key (lint 0004). It already has
-- an id column; uncomment after confirming its values are unique:
--   SELECT id FROM public.cw_air_alerts GROUP BY id HAVING count(*) > 1;
-- ---------------------------------------------------------------------------
-- ALTER TABLE public.cw_air_alerts ADD PRIMARY KEY (id);

-- ---------------------------------------------------------------------------
-- Zero-lock alternative for section B (run each alone, outside a transaction):
-- ---------------------------------------------------------------------------
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cw_device_owners_user_id ON public.cw_device_owners (user_id);
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cw_location_owners_location_id ON public.cw_location_owners (location_id);
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cw_location_owners_user_id ON public.cw_location_owners (user_id);
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cw_device_rule_assignments_dev_eui ON public.cw_device_rule_assignments (dev_eui);
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cw_device_rule_assignments_template_id ON public.cw_device_rule_assignments (template_id);
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cw_device_report_assignments_dev_eui ON public.cw_device_report_assignments (dev_eui);
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cw_rule_trigger_log_template_id ON public.cw_rule_trigger_log (template_id);
