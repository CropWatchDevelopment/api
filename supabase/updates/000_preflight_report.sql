-- =============================================================================
-- 000_preflight_report.sql
-- READ-ONLY preflight snapshot. Run this BEFORE and AFTER each update script
-- and keep the output. Nothing in this file modifies the database.
-- =============================================================================

-- 1. RLS state of every table in the public schema.
SELECT
    schemaname,
    tablename,
    rowsecurity AS rls_enabled,
    forcerowsecurity AS rls_forced
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY rowsecurity, tablename;

-- 2. Every policy in the public schema (name, command, roles, expressions).
SELECT
    tablename,
    policyname,
    cmd,
    roles::text,
    qual,
    with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- 3. Table privileges currently granted to anon / authenticated.
SELECT
    table_schema,
    table_name,
    grantee,
    string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privileges
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND grantee IN ('anon', 'authenticated')
GROUP BY table_schema, table_name, grantee
ORDER BY table_name, grantee;

-- 4. Permission level catalog.
SELECT * FROM public.cw_permission_level_types ORDER BY permission_level_id;

-- 5. Distribution of permission levels in the two ACL tables.
--    After 001 runs there must be NO rows at a level whose meaning changed:
--    the old data uses 3=Viewer / 4=Disabled; the new model uses
--    3=User / 4=Viewer / 5=Disabled.
SELECT 'cw_device_owners' AS tbl, permission_level, count(*)
FROM public.cw_device_owners
GROUP BY permission_level
UNION ALL
SELECT 'cw_location_owners', permission_level, count(*)
FROM public.cw_location_owners
GROUP BY permission_level
ORDER BY tbl, permission_level;

-- 6. Out-of-range or non-integer permission levels (must be empty before 001;
--    permission_level is numeric, so fractional values are technically possible).
SELECT 'cw_device_owners' AS tbl, id, dev_eui::text AS ref, permission_level
FROM public.cw_device_owners
WHERE permission_level IS NULL
   OR permission_level < 1
   OR permission_level > 4
   OR permission_level <> floor(permission_level)
UNION ALL
SELECT 'cw_location_owners', id, location_id::text, permission_level
FROM public.cw_location_owners
WHERE permission_level IS NULL
   OR permission_level < 1
   OR permission_level > 4
   OR permission_level <> floor(permission_level);

-- 7. Functions in public: SECURITY DEFINER flag, search_path config, and
--    EXECUTE grants for anon / authenticated / public.
SELECT
    p.oid::regprocedure::text AS signature,
    p.prosecdef AS security_definer,
    coalesce(p.proconfig::text, '') AS config,
    has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
ORDER BY p.prosecdef DESC, p.proname;

-- 8. Foreign tables exposed through PostgREST-visible schemas (stripe FDW).
SELECT foreign_table_schema, foreign_table_name
FROM information_schema.foreign_tables
ORDER BY 1, 2;

-- 9. Duplicate / unused index candidates referenced by 007.
SELECT
    t.relname AS table_name,
    i.relname AS index_name,
    pg_get_indexdef(ix.indexrelid) AS definition
FROM pg_index ix
JOIN pg_class i ON i.oid = ix.indexrelid
JOIN pg_class t ON t.oid = ix.indrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = 'public'
  AND t.relname IN (
      'cw_air_alerts', 'cw_device_owners', 'cw_devices', 'report_user_schedule',
      'cw_location_owners', 'cw_device_rule_assignments', 'cw_device_report_assignments'
  )
ORDER BY t.relname, i.relname;
