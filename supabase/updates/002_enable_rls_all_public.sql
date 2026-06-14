-- =============================================================================
-- 002_enable_rls_all_public.sql
-- Enable Row Level Security on EVERY table in the public schema.
--
-- Posture: API-only. With RLS enabled and (after 003/004) no permissive
-- policies or grants for anon/authenticated, PostgREST access with the anon
-- key is fully denied. The NestJS API uses the service_role key, which
-- bypasses RLS, so the API keeps working unchanged.
--
-- Notes:
--  * Idempotent — ENABLE ROW LEVEL SECURITY on an already-enabled table is a
--    no-op.
--  * We intentionally do NOT use FORCE ROW LEVEL SECURITY: the table owner
--    (postgres) and SECURITY DEFINER functions owned by it (e.g.
--    handle_new_user) must keep working for auth triggers and maintenance.
--  * Tables known to have RLS disabled at review time (2026-06-10):
--    devices, permissions, cw_rule_criteria, report_user_schedule,
--    user_discord_connections (exposes a Discord access_token!), cw_water_data,
--    report_alert_points, report_recipients, cw_air_annotations,
--    report_data_processing_schedules, cw_rule_templates,
--    cw_rule_template_criteria, cw_rule_template_actions,
--    cw_device_rule_assignments, cw_rule_state, cw_rule_trigger_log,
--    cw_rule_monthly_usage, cw_report_templates, cw_device_report_assignments,
--    cw_report_template_schedule, cw_report_template_recipients,
--    cw_report_template_alert_points,
--    cw_report_template_data_processing_schedules.
-- =============================================================================

DO $$
DECLARE
    tbl record;
BEGIN
    FOR tbl IN
        SELECT schemaname, tablename
        FROM pg_tables
        WHERE schemaname = 'public'
        ORDER BY tablename
    LOOP
        EXECUTE format(
            'ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY;',
            tbl.schemaname, tbl.tablename
        );
    END LOOP;
END
$$;

-- Post-check: every public table must now report rls_enabled = true.
SELECT tablename, rowsecurity AS rls_enabled
FROM pg_tables
WHERE schemaname = 'public' AND rowsecurity = false
ORDER BY tablename;
-- (expected: zero rows)
