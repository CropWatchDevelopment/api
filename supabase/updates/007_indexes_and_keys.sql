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
-- cw_air_alerts: keep cw_air_alerts_triggering_rule_group_key.
-- This duplicate is a UNIQUE *constraint*, so its index can't be dropped with
-- DROP INDEX (2BP01) — drop the constraint instead (uniqueness is preserved by
-- the kept constraint). No CASCADE: fail loudly if an FK depends on it.
ALTER TABLE public.cw_air_alerts DROP CONSTRAINT IF EXISTS cw_air_alerts_triggering_rule_group_key1;

-- cw_device_owners: keep cw_device_owners_dev_eui_idx
DROP INDEX IF EXISTS public.idx_cdo_dev_eui;

-- cw_device_owners: keep idx_cw_device_owners_dev_user_perm
DROP INDEX IF EXISTS public.idx_cdo_dev_eui_user_pl;

-- cw_devices: keep idx_cw_devices_location_id
DROP INDEX IF EXISTS public.idx_cw_devices_location;

-- report_user_schedule: keep the primary key, drop the redundant unique index.
-- It is a UNIQUE *constraint* (duplicate of the pkey on id), so drop the
-- constraint, not the index. No CASCADE: fail loudly if an FK depends on it.
ALTER TABLE public.report_user_schedule DROP CONSTRAINT IF EXISTS report_user_schedule_id_key;

-- Unused index flagged by the advisor on a permission column that is always
-- queried together with (dev_eui, user_id) — covered by
-- idx_cw_device_owners_dev_user_perm.
DROP INDEX IF EXISTS public.cw_device_owners_permission_level_idx;

-- ---------------------------------------------------------------------------
-- B) FK indexes that back real API query patterns
-- ---------------------------------------------------------------------------
-- NOTE: `CREATE INDEX IF NOT EXISTS` matches on the index *name*, not its
-- column coverage. The 000 preflight (section 9) confirmed these single-column
-- indexes ALREADY EXIST under different names, so creating same-coverage
-- indexes here would re-introduce duplicates — the exact thing section A
-- removes. They are intentionally omitted (existing index in parentheses):
--   user_id on cw_device_owners              (idx_cdo_user)
--   location_id on cw_location_owners        (cw_location_owners_location_id_idx)
--   user_id on cw_location_owners            (idx_clo_user)
--   dev_eui on cw_device_report_assignments  (cw_device_report_assignments_dev_eui_idx)

-- Rule/report template fan-out (rules-new / reports-new modules).
-- cw_device_rule_assignments has only UNIQUE (dev_eui, template_id) + pkey, so
-- template_id has no standalone index. (The dev_eui index is prefix-covered by
-- that unique; kept as a small explicit single-column index.)
CREATE INDEX IF NOT EXISTS idx_cw_device_rule_assignments_dev_eui
    ON public.cw_device_rule_assignments (dev_eui);
CREATE INDEX IF NOT EXISTS idx_cw_device_rule_assignments_template_id
    ON public.cw_device_rule_assignments (template_id);

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
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cw_device_rule_assignments_dev_eui ON public.cw_device_rule_assignments (dev_eui);
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cw_device_rule_assignments_template_id ON public.cw_device_rule_assignments (template_id);
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cw_rule_trigger_log_template_id ON public.cw_rule_trigger_log (template_id);
