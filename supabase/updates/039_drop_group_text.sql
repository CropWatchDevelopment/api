-- 039_drop_group_text.sql
-- Drops the free-text group columns that 038 replaced with group_id.
--
-- After 038, the API reads and writes groups through cw_locations.group_id /
-- cw_devices.group_id and returns the group's name as `group`, so nothing
-- served by the API reads the text columns any more. This removes them and the
-- 038 transition bridge (the sync_group_from_text triggers that turned
-- old-API text writes into group_id).
--
-- PREFLIGHT — run only when ALL of these are true:
--   1. The API that reads group_id is live: GET https://api.cropwatch.io/docs-json
--      lists the /v1/location-groups and /v1/device-groups routes.
--   2. The local twin's data handler (cw-data-handler-ts LavinMQ-to-Postgres
--      on the on-prem server 192.168.1.25, docs/local-twin.md) runs the
--      MetadataSync that no longer copies cw_devices."group". (An older
--      MetadataSync keeps working — Bun binds the missing value as NULL — it
--      just writes NULL into the twin's own "group" column.)
--   3. Nothing else reads the columns (checked 2026-11-22: no view, function,
--      policy, cron job or publication column list does; pg_stat_statements
--      shows only the API writing them; the other services in the cropwatch
--      repos do not use them).
--
-- After this runs the OLD API cannot come back without the ROLLBACK block
-- below. Re-running is a no-op (IF EXISTS). Patch database.types.ts (api +
-- CropWatch) after: drop `group` from cw_devices and cw_locations.

BEGIN;

SET LOCAL lock_timeout = '5s';

-- Same lock order as 038 (devices, then locations): no deadlock with requests.
LOCK TABLE public.cw_devices, public.cw_locations IN ACCESS EXCLUSIVE MODE;

DROP TRIGGER IF EXISTS sync_group_from_text ON public.cw_locations;
DROP TRIGGER IF EXISTS sync_group_from_text ON public.cw_devices;
DROP FUNCTION IF EXISTS public.cw_location_group_text_bridge();
DROP FUNCTION IF EXISTS public.cw_device_group_text_bridge();
DROP FUNCTION IF EXISTS public.cw_group_text_name(text, integer);

ALTER TABLE public.cw_locations DROP COLUMN IF EXISTS "group";
ALTER TABLE public.cw_devices DROP COLUMN IF EXISTS "group";

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ---------------------------------------------------------------------------
-- OPS — verification (read-only; expect 0 rows)
-- ---------------------------------------------------------------------------
-- SELECT table_name, column_name FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name IN ('cw_locations', 'cw_devices') AND column_name = 'group';

-- ---------------------------------------------------------------------------
-- ROLLBACK (only if an API that reads the text columns has to come back).
-- Order matters:
--   1. Run this block: it re-creates the text columns and fills them from the
--      groups.
--   2. THEN, if that old API will write groups, re-run 038 to re-create the
--      bridge. (038 skips its backfill, and its check passes because the
--      text now matches. Re-creating the bridge before step 1 would make 038
--      abort on its check.)
-- ---------------------------------------------------------------------------
-- BEGIN;
-- ALTER TABLE public.cw_locations ADD COLUMN IF NOT EXISTS "group" text;
-- ALTER TABLE public.cw_devices ADD COLUMN IF NOT EXISTS "group" text;
-- UPDATE public.cw_locations l SET "group" = g.name FROM public.cw_location_groups g WHERE g.id = l.group_id;
-- UPDATE public.cw_devices d SET "group" = g.name FROM public.cw_device_groups g WHERE g.id = d.group_id;
-- NOTIFY pgrst, 'reload schema';
-- COMMIT;
