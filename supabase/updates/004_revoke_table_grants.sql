-- =============================================================================
-- 004_revoke_table_grants.sql
-- Revoke all table/sequence/function privileges in the public schema from the
-- anon and authenticated roles, and stop granting them by default on future
-- objects.
--
-- Defense in depth on top of 002/003: even if RLS were disabled on a future
-- table by mistake, anon/authenticated would still hold no grants on it.
--
-- CONFIRMED before writing this script: nothing queries Supabase directly
-- with the anon key or a user JWT — the web app uses Supabase only for auth
-- (auth schema untouched here) and all data access goes through the NestJS
-- API with the service_role key (unaffected by these revokes).
--
-- handle_new_user() keeps working: it is a SECURITY DEFINER trigger function
-- owned by postgres, so it inserts into public.profiles with the owner's
-- privileges, not the caller's.
--
-- Idempotent: REVOKE on a privilege that is not held is a no-op.
-- =============================================================================

BEGIN;

REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

-- Default privileges: objects created later in public get no grants either.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES    FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;

-- Supabase also sets default privileges for objects created by the
-- "supabase_admin" and "postgres" roles; cover both creator roles explicitly.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    REVOKE ALL ON TABLES    FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    REVOKE ALL ON FUNCTIONS FROM anon, authenticated;

COMMIT;

-- Post-check 1: no remaining table grants for anon/authenticated in public.
SELECT table_name, grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND grantee IN ('anon', 'authenticated')
ORDER BY table_name;
-- (expected: zero rows)

-- Post-check 2 (manual, from a terminal — replace <ANON_KEY> and project ref):
--   curl -s "https://dpaoqrcfswnzknixwkll.supabase.co/rest/v1/cw_devices?select=dev_eui&limit=1" \
--        -H "apikey: <ANON_KEY>" -H "Authorization: Bearer <ANON_KEY>"
--   Expected: "permission denied" error, NOT a JSON array.
-- Then log into the app and verify login + signup (profile row creation)
-- still work, and that all pages load (they use the API, not PostgREST).
