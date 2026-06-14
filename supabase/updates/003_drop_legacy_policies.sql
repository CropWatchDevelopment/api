-- =============================================================================
-- 003_drop_legacy_policies.sql
-- Drop every RLS policy granting access to anon / authenticated / public.
--
-- Posture: API-only. All client data access goes through the NestJS API
-- (service_role, bypasses RLS). With these policies removed and RLS enabled
-- (002), direct PostgREST access with the anon key or a user JWT is denied
-- on every table.
--
-- Policies intentionally KEPT (scoped to service_role, harmless and explicit):
--   * api_keys              — "Allow service_role to read api_keys"
--   * babylon_in_connections — "Enable read access for service_role users"
--
-- Several of the dropped policies were broken anyway, e.g. the cw_air_data /
-- cw_soil_data / cw_relay_data SELECT policies compared cw_device_owners
-- columns to themselves (tautology), effectively granting every authenticated
-- user read access to ALL telemetry; cw_traffic2 allowed anonymous
-- INSERT/UPDATE of any row; profiles was world-readable.
--
-- Idempotent: every statement uses DROP POLICY IF EXISTS.
-- Enumerated from pg_policies on 2026-06-10 (see 000 preflight output).
-- =============================================================================

BEGIN;

-- communication_methods
DROP POLICY IF EXISTS "Enable read access for all users" ON public.communication_methods;

-- cw_air_data (policy name really does start with two spaces)
DROP POLICY IF EXISTS "  Select all cw_air_data where cw_device_owner has user_id" ON public.cw_air_data;

-- cw_data_metadata
DROP POLICY IF EXISTS "Enable read access for all users" ON public.cw_data_metadata;

-- cw_device_gateway
DROP POLICY IF EXISTS "Enable read access for all users" ON public.cw_device_gateway;

-- cw_device_owners
DROP POLICY IF EXISTS "Enable delete for users based on user_id" ON public.cw_device_owners;
DROP POLICY IF EXISTS "Owners can see all rows for same dev_eui" ON public.cw_device_owners;
DROP POLICY IF EXISTS "Policy with table joins" ON public.cw_device_owners;
DROP POLICY IF EXISTS "Update Policy" ON public.cw_device_owners;
DROP POLICY IF EXISTS "Users can see their own rows" ON public.cw_device_owners;

-- cw_device_type
DROP POLICY IF EXISTS "Enable cw_device_types read access for all users" ON public.cw_device_type;

-- cw_device_x_cw_data_metadata
DROP POLICY IF EXISTS "Enable read access for all users" ON public.cw_device_x_cw_data_metadata;

-- cw_devices
DROP POLICY IF EXISTS "Devices select: owner or pl<=3" ON public.cw_devices;
DROP POLICY IF EXISTS "Enable delete for users based on user_id" ON public.cw_devices;
DROP POLICY IF EXISTS "Enable insert for users based on user_id" ON public.cw_devices;
DROP POLICY IF EXISTS "Select devices where you or a teammate has admin perms" ON public.cw_devices;
DROP POLICY IF EXISTS "Update if owner, OR is admin" ON public.cw_devices;
DROP POLICY IF EXISTS "allow only authenticated user to view their own cw_devices" ON public.cw_devices;

-- cw_gateways
DROP POLICY IF EXISTS "Enable read access for all users" ON public.cw_gateways;

-- cw_gateways_owners
DROP POLICY IF EXISTS "Enable read access for all users" ON public.cw_gateways_owners;

-- cw_location_owners
DROP POLICY IF EXISTS "Select Users if they have permissions" ON public.cw_location_owners;
DROP POLICY IF EXISTS "cw_location_owners_delete" ON public.cw_location_owners;
DROP POLICY IF EXISTS "cw_location_owners_insert" ON public.cw_location_owners;
DROP POLICY IF EXISTS "cw_location_owners_select" ON public.cw_location_owners;
DROP POLICY IF EXISTS "cw_location_owners_update" ON public.cw_location_owners;

-- cw_locations
DROP POLICY IF EXISTS "Enable delete for users based on user_id" ON public.cw_locations;
DROP POLICY IF EXISTS "Enable insert for users based on user_id" ON public.cw_locations;
DROP POLICY IF EXISTS "admin_read_all_locations_by_email" ON public.cw_locations;
DROP POLICY IF EXISTS "locations: owner can read" ON public.cw_locations;
DROP POLICY IF EXISTS "select_locations_visible_to_members" ON public.cw_locations;
DROP POLICY IF EXISTS "update_if_user_owns_table_or_admin" ON public.cw_locations;

-- cw_notifier_types
DROP POLICY IF EXISTS "Enable read access for all users" ON public.cw_notifier_types;

-- cw_permission_level_types
DROP POLICY IF EXISTS "Enable read access for all users" ON public.cw_permission_level_types;

-- cw_relay_data
DROP POLICY IF EXISTS "Select All" ON public.cw_relay_data;

-- cw_rule_triggered
DROP POLICY IF EXISTS "Enable read access for all users" ON public.cw_rule_triggered;

-- cw_rules
DROP POLICY IF EXISTS "Enable Select for users based on user_id" ON public.cw_rules;
DROP POLICY IF EXISTS "Enable delete for users based on user_id" ON public.cw_rules;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON public.cw_rules;
DROP POLICY IF EXISTS "Enable update for users based on user_id" ON public.cw_rules;

-- cw_soil_data
DROP POLICY IF EXISTS "Select all cw_soil_data where cw_device_owner has user_id" ON public.cw_soil_data;

-- cw_traffic2
DROP POLICY IF EXISTS "Enable read access for all users" ON public.cw_traffic2;
DROP POLICY IF EXISTS "insert any" ON public.cw_traffic2;
DROP POLICY IF EXISTS "update any" ON public.cw_traffic2;

-- devices (legacy table; its policies were dead while RLS was disabled)
DROP POLICY IF EXISTS "Allow device owners access." ON public.devices;
DROP POLICY IF EXISTS "select_user_devices_only" ON public.devices;

-- ip_log
DROP POLICY IF EXISTS "Enable read access for all users" ON public.ip_log;

-- locations (legacy table)
DROP POLICY IF EXISTS "select if you have been granted permission" ON public.locations;

-- profiles
DROP POLICY IF EXISTS "Public profiles are viewable by everyone." ON public.profiles;
DROP POLICY IF EXISTS "Users can insert their own profile." ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile." ON public.profiles;

-- report_user_schedule (policies were dead while RLS was disabled)
DROP POLICY IF EXISTS "Enable insert for users based on user_id" ON public.report_user_schedule;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.report_user_schedule;
DROP POLICY IF EXISTS "Enable update for users based on email" ON public.report_user_schedule;

-- reports
DROP POLICY IF EXISTS "User allowed to crud" ON public.reports;

COMMIT;

-- Post-check: only the two service_role policies should remain.
SELECT tablename, policyname, roles::text
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
