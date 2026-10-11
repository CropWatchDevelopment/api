-- =============================================================================
-- 030_relay_history.sql
-- =============================================================================
-- Relay history: every relay state the device reports + every relay command
-- CropWatch sends, so the relay page can show what changed, who asked for it
-- and whether the device confirmed it (GET /v1/relay/:dev_eui/history).
--
--  A) cw_relay_reports — append-only log of device relay reports.
--     cw_relay_data keeps ONE row per device (UNIQUE dev_eui, overwritten by
--     every uplink), so it cannot answer "what happened". This table is
--     written by a trigger on cw_relay_data, which captures both writers
--     without code changes:
--       * the API's TTI webhook (POST /v1/relay/tti/up): upsert,
--         last_update = TTI received_at with microseconds;
--       * the data handler's cloud relayWriter: UPDATE, last_update in
--         milliseconds, skipped when the stored row is newer.
--     Both usually apply the same uplink. Their copies differ only below the
--     millisecond, and a device cannot send two uplinks within one second, so
--     a unique index on (dev_eui, received second) keeps one row per uplink
--     (it also absorbs webhook replays). Every report is kept, not only
--     changes: the API needs the unchanged ones to tell whether a command
--     (or a status request) was confirmed. ~144 rows/device/day.
--  B) cw_relay_commands — one row per command the API sent to TTI (fixed
--     on/off, timed pulse, status request): when (sent_at = the API's
--     requestedAt), what, and who (requested_by -> profiles, SET NULL when
--     the profile is deleted). request_id is the cropwatch:request:<uuid>
--     TTI correlation id. duration_seconds, not ms: the longest pulse
--     (4,294,967 s) overflows int4 in milliseconds.
--  C) cw_relay_data_log_report() + trigger. Logs a report when the row is new
--     or its last_update / relay state changed; a replayed webhook changes
--     nothing and is skipped. The column list keeps it from firing on the
--     dev_eui-only UPDATE cascaded from a device replacement. A logging
--     failure is downgraded to a WARNING: it must never block the relay state
--     write.
--  D) Seed: each device's current cw_relay_data state as its first report, so
--     the first change after this script has a baseline. Runs after CREATE
--     TRIGGER: the trigger's lock holds both writers off until COMMIT, so no
--     uplink can fall between the snapshot and the trigger.
--
-- Both tables cascade from cw_devices exactly like cw_relay_data: ON UPDATE
-- CASCADE (DevicesService.replaceDevice rewrites cw_devices.dev_eui) and
-- ON DELETE CASCADE (delete_device, 028, needs no change). RLS on, no
-- policies, no anon/authenticated grants: the API and the data handler use
-- the service role.
--
-- Retention: not pruned. ~420k report rows/year at today's 8 relays; add
-- cw_relay_reports to the sensor-data retention when that is scripted.
--
-- Run as postgres (the SQL editor default): the trigger function is
-- SECURITY DEFINER and relies on the owner bypassing RLS. Additive and
-- idempotent. Run BEFORE deploying the relay-history API release. Patch
-- database.types.ts (api + CropWatch) after: two tables, no Functions entry.
-- Rollback: bottom of file.
-- =============================================================================

BEGIN;

-- A) cw_relay_reports ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cw_relay_reports (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dev_eui     text        NOT NULL
                          REFERENCES public.cw_devices (dev_eui) ON UPDATE CASCADE ON DELETE CASCADE,
  reported_at timestamptz NOT NULL,   -- TTI received_at of the uplink (cw_relay_data.last_update)
  relay_1     boolean,
  relay_2     boolean,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- One row per uplink. AT TIME ZONE 'UTC' makes the expression immutable
-- (date_trunc on a timestamptz is only STABLE and cannot be indexed).
CREATE UNIQUE INDEX IF NOT EXISTS cw_relay_reports_dev_eui_second_key
  ON public.cw_relay_reports (dev_eui, date_trunc('second', reported_at AT TIME ZONE 'UTC'));

-- History reads: dev_eui = $1 AND reported_at in a range, ordered by time.
CREATE INDEX IF NOT EXISTS cw_relay_reports_dev_eui_reported_at_idx
  ON public.cw_relay_reports (dev_eui, reported_at DESC);

ALTER TABLE public.cw_relay_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cw_relay_reports FROM anon, authenticated;

COMMENT ON TABLE public.cw_relay_reports IS
  'Append-only log of relay states reported by relay devices, one row per uplink; written by the cw_relay_data_log_report trigger (030).';

-- B) cw_relay_commands --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cw_relay_commands (
  id               bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dev_eui          text        NOT NULL
                               REFERENCES public.cw_devices (dev_eui) ON UPDATE CASCADE ON DELETE CASCADE,
  sent_at          timestamptz NOT NULL,   -- API time just before the TTI call (response requestedAt)
  command          text        NOT NULL CHECK (command IN ('fixed', 'pulse', 'status')),
  relay            smallint    CHECK (relay IN (1, 2)),
  target_state     text        CHECK (target_state IN ('on', 'off')),
  duration_seconds integer     CHECK (duration_seconds > 0),
  requested_by     uuid        REFERENCES public.profiles (id) ON DELETE SET NULL,
  request_id       uuid        NOT NULL,   -- TTI correlation id cropwatch:request:<uuid>
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cw_relay_commands_shape CHECK (
       (command = 'fixed'  AND relay IS NOT NULL AND target_state IS NOT NULL AND duration_seconds IS NULL)
    OR (command = 'pulse'  AND relay IS NOT NULL AND target_state = 'on'      AND duration_seconds IS NOT NULL)
    OR (command = 'status' AND relay IS NULL     AND target_state IS NULL     AND duration_seconds IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS cw_relay_commands_dev_eui_sent_at_idx
  ON public.cw_relay_commands (dev_eui, sent_at DESC);

ALTER TABLE public.cw_relay_commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cw_relay_commands FROM anon, authenticated;

COMMENT ON TABLE public.cw_relay_commands IS
  'Relay commands the API sent to TTI (030): fixed on/off, timed pulse, status request, and who sent them.';

-- C) report trigger -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cw_relay_data_log_report() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
    AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.last_update IS NOT DISTINCT FROM OLD.last_update
     AND NEW.relay_1     IS NOT DISTINCT FROM OLD.relay_1
     AND NEW.relay_2     IS NOT DISTINCT FROM OLD.relay_2 THEN
    RETURN NULL;  -- replayed webhook: nothing new
  END IF;

  IF NEW.last_update IS NULL THEN
    RETURN NULL;  -- no report time, nothing to log
  END IF;

  BEGIN
    INSERT INTO public.cw_relay_reports (dev_eui, reported_at, relay_1, relay_2)
    VALUES (NEW.dev_eui, NEW.last_update, NEW.relay_1, NEW.relay_2)
    ON CONFLICT DO NOTHING;  -- the other writer already logged this uplink
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'cw_relay_data_log_report(%): %', NEW.dev_eui, SQLERRM;
  END;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS cw_relay_data_log_report ON public.cw_relay_data;
CREATE TRIGGER cw_relay_data_log_report
  AFTER INSERT OR UPDATE OF last_update, relay_1, relay_2 ON public.cw_relay_data
  FOR EACH ROW EXECUTE FUNCTION public.cw_relay_data_log_report();

-- Firing a trigger needs no EXECUTE grant; nobody should call it directly.
REVOKE ALL ON FUNCTION public.cw_relay_data_log_report() FROM PUBLIC, anon, authenticated;

-- D) seed -------------------------------------------------------------------------
INSERT INTO public.cw_relay_reports (dev_eui, reported_at, relay_1, relay_2)
SELECT dev_eui, last_update, relay_1, relay_2
  FROM public.cw_relay_data
 WHERE last_update IS NOT NULL
ON CONFLICT DO NOTHING;

COMMIT;

-- =============================================================================
-- OPS — verification (read-only, run right after COMMIT)
-- =============================================================================
-- SELECT dev_eui, count(*) AS reports, max(reported_at) AS newest
--   FROM public.cw_relay_reports GROUP BY 1 ORDER BY 1;
-- -- expect one row per relay device (the seed) right away; each online relay
-- -- then gains ~6 reports/hour
-- SELECT tgname, tgenabled FROM pg_trigger
--  WHERE tgrelid = 'public.cw_relay_data'::regclass AND NOT tgisinternal;
-- -- expect: cw_relay_data_log_report | O
-- SELECT has_table_privilege('anon', 'public.cw_relay_reports', 'SELECT')                AS anon_reports,
--        has_table_privilege('authenticated', 'public.cw_relay_commands', 'SELECT')      AS auth_commands,
--        has_function_privilege('anon', 'public.cw_relay_data_log_report()', 'EXECUTE')  AS anon_exec;
-- -- expect: f, f, f
-- -- After an hour of uplinks, no uplink logged twice (expect 0 rows):
-- SELECT a.dev_eui, a.reported_at, b.reported_at
--   FROM public.cw_relay_reports a
--   JOIN public.cw_relay_reports b
--     ON b.dev_eui = a.dev_eui AND b.id > a.id
--    AND b.reported_at BETWEEN a.reported_at - interval '2 seconds' AND a.reported_at + interval '2 seconds';
-- -- If the API's requester embed errors with "Could not find a relationship":
-- -- NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- ROLLBACK (roll the API back first: it would 500 on /history and log, but
-- survive, failed command inserts)
-- =============================================================================
-- BEGIN;
-- DROP TRIGGER IF EXISTS cw_relay_data_log_report ON public.cw_relay_data;
-- DROP FUNCTION IF EXISTS public.cw_relay_data_log_report();
-- DROP TABLE IF EXISTS public.cw_relay_commands;
-- DROP TABLE IF EXISTS public.cw_relay_reports;
-- COMMIT;
