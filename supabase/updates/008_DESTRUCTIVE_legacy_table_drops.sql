-- =============================================================================
-- !!! 008_DESTRUCTIVE_legacy_table_drops.sql !!!
-- =============================================================================
-- !!  THIS FILE PERMANENTLY DELETES TABLES AND THEIR DATA.                   !!
-- !!  Take a backup / snapshot of the project FIRST.                         !!
-- !!  Wrapped in a single transaction: if any statement hits an unexpected   !!
-- !!  dependency the WHOLE thing rolls back (nothing is half-dropped).       !!
-- =============================================================================
--
-- PREREQUISITE (hard) -- deploy the code change first:
--   The device-list query in src/v1/devices/devices.service.ts no longer embeds
--   cw_rules(*) (removed 2026-06-18). That commit MUST be merged to master and
--   live on Vercel BEFORE you run this, or the device list 500s the instant
--   cw_rules disappears. (The cw_air_alerts(*) embed on line ~360 is unaffected.)
--
-- Verified 2026-06-18 (this session):
--   * Rules cutover COMPLETE -- 011 + 012 + 013 run & verified; every live alert
--     is on an active template. Only intentional junk remains in cw_rules.
--   * Reports run on the new cw_report_template* schema; no code reads the legacy
--     reports* tables (confirmed by grep). Kevin chose to drop them anyway.
--   * Dependency scan (FK by OID, not text): the ONLY external FK into the drop
--     set is cw_air_alerts.rule_group_id -> cw_rules. cw_air_alerts is EMPTY (0
--     rows) and stays; its stale FK is dropped in Block 3 before cw_rules. No
--     views/matviews reference any target.
--   * Row counts: devices 44, locations 4, permissions 0; dup-telemetry 0/0;
--     cw_rules 107, cw_rule_criteria 107, cw_rule_triggered 3965; reports 16 +
--     recipients 48 + alert_points 29 + schedules 38 + user_schedule 29;
--     babylon ~44 (2yr stale, in pre-rollout backup).
--
-- OPTIONAL pre-flight counts (run on their own first if you want to eyeball):
--   SELECT 'cw_rules' t, count(*) FROM public.cw_rules
--   UNION ALL SELECT 'reports', count(*) FROM public.reports
--   UNION ALL SELECT 'cw_air_alerts (must stay 0)', count(*) FROM public.cw_air_alerts;
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Block 1 -- Legacy v0 tables (superseded by cw_devices / cw_locations /
--   cw_location_owners). No code, FK, or view references. Single statement lets
--   Postgres resolve any internal order.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS
  public.permissions,
  public.devices,
  public.locations;

-- ---------------------------------------------------------------------------
-- Block 2 -- Empty duplicate telemetry tables (0 rows).
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS
  public.cw_soil_data_duplicate,
  public.cw_air_data_duplicate;

-- ---------------------------------------------------------------------------
-- Block 3a -- Legacy rules engine (replaced by cw_rule_templates et al.).
--   First drop the stale external FK from the (empty) cw_air_alerts table, then
--   the rules tables. cw_air_alerts itself is KEPT (0 rows, still referenced by
--   devices.service.ts:360 via a different relationship).
--   cw_rule_triggered holds 3965 history rows -- export first if you want it.
-- ---------------------------------------------------------------------------
ALTER TABLE public.cw_air_alerts
  DROP CONSTRAINT IF EXISTS cw_air_alerts_rule_group_id_fkey;

DROP TABLE IF EXISTS
  public.cw_rule_criteria,
  public.cw_rule_triggered,
  public.cw_rules;

-- ---------------------------------------------------------------------------
-- Block 3b -- Legacy reports engine (replaced by cw_report_template*). Children
--   (report_*) and parent (reports) dropped together; reports_templates is
--   independent. DELETES real data: 16 reports + 48 recipients + 29 alert
--   points + 67 schedule rows. Back these up first if you may want them.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS
  public.report_recipients,
  public.report_alert_points,
  public.report_data_processing_schedules,
  public.report_user_schedule,
  public.reports_templates,
  public.reports;

-- ---------------------------------------------------------------------------
-- Block 4 -- Retired "Babylon" data-routing subsystem (~44 rows, 2yr stale, in
--   the pre-rollout backup; babylon_notifiers carried credential columns).
--   No external dependency -- the internal FK chain resolves within one
--   statement, and it fails loudly (no CASCADE) if anything outside appears.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS
  public.babylon_input_output,
  public.babylon_notifiers_out_connections,
  public.babylon_notifiers,
  public.babylon_in_connections,
  public.babylon_out_connections,
  public.babylon_connection_types,
  public.babylon_decoders;

COMMIT;

-- =============================================================================
-- After COMMIT: confirm the tables are gone (each should return false):
--   SELECT to_regclass('public.cw_rules')   IS NOT NULL AS cw_rules_still_exists,
--          to_regclass('public.reports')    IS NOT NULL AS reports_still_exists,
--          to_regclass('public.devices')    IS NOT NULL AS v0_devices_still_exists,
--          to_regclass('public.babylon_decoders') IS NOT NULL AS babylon_still_exists;
-- And re-run the rules coverage gate / hit the device-list endpoint to confirm
-- nothing regressed.
-- =============================================================================
