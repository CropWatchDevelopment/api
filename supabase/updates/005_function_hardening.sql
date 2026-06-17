-- =============================================================================
-- 005_function_hardening.sql
-- Two fixes flagged by the Supabase security advisor:
--
--  A) Pin search_path on the 11 functions where it was role-mutable
--     (lint 0011_function_search_path_mutable). Their bodies reference public
--     tables unqualified (cw_devices, cw_soil_data, road_events, ...) and some
--     use extension functions (time_bucket/first/last, extensions.http), so we
--     pin to 'public' / 'public, extensions' instead of '' to avoid breaking
--     them.
--
--  B) Revoke EXECUTE from anon / authenticated / PUBLIC on all 15
--     SECURITY DEFINER functions (lints 0028/0029) so they can no longer be
--     called via POST /rest/v1/rpc/... with the anon key. service_role keeps
--     EXECUTE. Trigger-invoked functions are unaffected: PostgreSQL checks
--     EXECUTE on trigger functions at trigger CREATION time, not when the
--     trigger fires.
--
-- Signatures were read from pg_proc on 2026-06-10. If a signature has changed
-- since, regenerate the statements with the helper query at the bottom.
-- Idempotent: ALTER ... SET overwrites, REVOKE/GRANT are no-ops when already
-- in the desired state.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- A) Pin search_path
-- ---------------------------------------------------------------------------
ALTER FUNCTION public.cw_soil_data_changes() SET search_path = public;
ALTER FUNCTION public.cw_traffic_daily_totals(text, timestamp with time zone, timestamp with time zone, text) SET search_path = public;
ALTER FUNCTION public.delete_avatar(text) SET search_path = public;
ALTER FUNCTION public.delete_old_avatar() SET search_path = public;
ALTER FUNCTION public.delete_old_profile() SET search_path = public;
ALTER FUNCTION public.delete_storage_object(text, text) SET search_path = public, extensions;
ALTER FUNCTION public.get_location_for_user(uuid) SET search_path = public;
ALTER FUNCTION public.get_filtered_device_report_data_multi_v2(text, timestamp with time zone, timestamp with time zone, integer, text[], text[], double precision[], double precision[], text) SET search_path = public;
ALTER FUNCTION public.get_road_events(text) SET search_path = public;
ALTER FUNCTION public.get_road_events_summary1(text[], timestamp with time zone, text, timestamp with time zone, text) SET search_path = public;

-- get_hloc_data: 3 SECURITY INVOKER function overloads. They build dynamic SQL
-- over public tables and use TimescaleDB helpers (time_bucket / first / last),
-- hence extensions too.
-- NOTE: two further get_hloc_data *procedures* existed in prod as dead
-- experiments — (timestamp, timestamp, text, text, text) and
-- (timestamp, timestamp, text, text, text, text) (the latter returns an OUT
-- refcursor). They are PROCEDUREs, not functions, so ALTER FUNCTION errors on
-- them (42809). They are dropped as dead code rather than hardened:
--   DROP PROCEDURE IF EXISTS public.get_hloc_data(timestamp without time zone, timestamp without time zone, text, text, text);
--   DROP PROCEDURE IF EXISTS public.get_hloc_data(timestamp without time zone, timestamp without time zone, text, text, text, text);
ALTER FUNCTION public.get_hloc_data(text, text, text, text) SET search_path = public, extensions;
ALTER FUNCTION public.get_hloc_data(text, text, text, text, text) SET search_path = public, extensions;
ALTER FUNCTION public.get_hloc_data(timestamp without time zone, timestamp without time zone, text, text, character varying) SET search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- B) Lock down SECURITY DEFINER functions
-- ---------------------------------------------------------------------------
-- Note: the is_*_for() helpers were only referenced by the RLS policies
-- dropped in 003; after that they have no callers besides service_role.
DO $$
DECLARE
    fn text;
    secdef_functions text[] := ARRAY[
        'public.cw_air_data_changes()',
        'public.cw_relay_data_changes()',
        'public.delete_avatar(text)',
        'public.delete_old_avatar()',
        'public.delete_old_profile()',
        'public.delete_storage_object(text, text)',
        'public.fn_log_rule_trigger()',
        'public.get_location_for_user(uuid)',
        'public.handle_new_user()',
        'public.is_device_admin_for(character varying)',
        'public.is_device_admin_for(text)',
        'public.is_device_member_for(text)',
        'public.is_device_owner_for(text)',
        'public.is_location_member_for(bigint)',
        'public.is_location_owner_for(bigint)'
    ];
BEGIN
    FOREACH fn IN ARRAY secdef_functions LOOP
        EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated;', fn);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role;', fn);
    END LOOP;
END
$$;

-- handle_new_user() is fired by the on_auth_user_created trigger, which the
-- Supabase Auth service creates/owns via supabase_auth_admin — keep its grant
-- explicit so a future trigger re-creation cannot fail.
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO supabase_auth_admin;

COMMIT;

-- Post-check: no SECURITY DEFINER function in public callable by anon or
-- authenticated, and no function without a pinned search_path.
SELECT
    p.oid::regprocedure::text AS signature,
    p.prosecdef AS security_definer,
    coalesce(p.proconfig::text, '') AS config,
    has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND (
      (p.prosecdef AND (
          has_function_privilege('anon', p.oid, 'EXECUTE')
          OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
      ))
      OR coalesce(p.proconfig::text, '') NOT LIKE '%search_path%'
  )
ORDER BY p.proname;
-- (expected: zero rows)

-- Helper: regenerate exact ALTER/REVOKE statements if signatures drift.
-- SELECT format('ALTER FUNCTION %s SET search_path = public;', p.oid::regprocedure)
-- FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public' AND coalesce(p.proconfig::text,'') NOT LIKE '%search_path%';
