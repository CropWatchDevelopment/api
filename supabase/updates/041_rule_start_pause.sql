-- =============================================================================
-- 041_rule_start_pause.sql
-- =============================================================================
-- Rules can be started and paused: by hand, on a start date, on a pause date,
-- and "start another rule when this one auto-pauses". Additive: every existing
-- rule keeps running exactly as before (all new columns are NULL or default).
--
--  A) cw_rule_templates gains
--       auto_start_at / auto_pause_at      one-shot dates, cleared when used
--       on_auto_pause_start_template_id    the rule to start after the auto-pause
--       status_changed_at / status_reason / status_changed_by_user /
--       status_changed_by_template         who or what last started/paused it
--       last_action_activated_at           re-activation cooldown (rule actions)
--       trigger_kind ('sensor' default)    'schedule' rules arrive with 042
--       org_id                             owner of a schedule rule (042); sensor
--                                          rules stay visible through their devices
--  B) cw_rule_status_events — one row per start/pause (and per refused or
--     suppressed attempt): the audit trail behind the Status column.
--  C) cw_rule_switch(...) — THE way to start or pause a rule. Used by the API
--     (Start/Pause buttons, save), by cw_rules_tick and, from 043 on, by the
--     alert service for rule-switch actions. One transaction: guard, cooldown,
--     is_active + status columns, close open alarms, audit row.
--       * Closing alarms: a paused rule has no open alarm, and a started rule
--         begins from a clean state, so a reading that is still bad alerts
--         again. Same shape as the alert service's administrative close
--         (cw_rule_trigger_log.reset_value stays NULL).
--       * Same-organization guard for reasons 'rule_action' and 'chain': every
--         organization the target touches (its devices' orgs, plus its own
--         org_id) must equal the source organization. A target with devices in
--         two organizations, or with none, is refused.
--       * Cooldown: a rule can be re-activated BY A RULE ACTION at most once per
--         60 minutes. Manual starts and dates are exempt.
--  D) cw_rules_tick() — runs every minute from pg_cron:
--       1. due start dates and pause dates, oldest first; each date is cleared
--          as it is used, so nothing automatic can loop: a chain or ring stops
--          when its dates run out (nothing automatic ever writes a date);
--       2. after an auto-pause, starts the chained rule (also when the rule had
--          been paused by hand before its date: the date is the handover);
--       3. sweep: closes alarms still open on paused rules (e.g. a device whose
--          reading was in flight when its rule was paused).
--     A date-driven change counts from its date (status_changed_at = the date,
--     not the minute the tick ran), so a backlog replays in order. And a date
--     never overrides a newer decision: when the rule was started or paused
--     AFTER the date had passed (only possible when the tick ran late), the date
--     is used up without effect and logged as 'suppressed'. The chained rule
--     still starts: the date is the handover.
--     Each item runs in its own exception block: a failing rule is logged as an
--     'error' event, its date is cleared, and the others carry on.
--
-- Loop safety, in one place: dates are one-shot; rule actions are capped by the
-- cooldown; a switch never evaluates the target (it fires on its own next
-- reading); the tick takes an advisory lock, so two runs never overlap.
--
-- The alert service needs no change for this file: it already skips a rule
-- whose cw_rule_templates.is_active is false (CropWatchRuleRepository reads it
-- on every message, no cache).
--
-- Tables: RLS on, no policies, no anon/authenticated grants (005 posture).
-- Functions: EXECUTE revoked from PUBLIC/anon/authenticated; cw_rule_switch is
-- granted to service_role (the API and the alert service call it over RPC).
--
-- HOW TO RUN (SQL editor, as postgres):
--   0. PREFLIGHT below (read-only). Expect 0 / 0.
--   1. The BEGIN ... COMMIT block.
--   2. Step 2: one tick by hand (expect all zeros), then the two schedules.
-- Re-runnable: columns and tables are IF NOT EXISTS, constraints are dropped
-- and re-added, functions are CREATE OR REPLACE, cron.schedule updates a job
-- that already has that name. NOT after 042 has run: this file would put back
-- the older cw_rule_switch / cw_rules_tick and Date/Time rules would stop
-- firing, so it refuses (re-run 042 instead).
--
-- PREFLIGHT (read-only)
-- SELECT
--   (SELECT count(*) FROM cw_rule_templates t JOIN cw_rule_state s ON s.template_id = t.id
--     WHERE t.is_active = false AND s.is_triggered)                    AS paused_rules_with_open_state,
--   (SELECT count(*) FROM cw_rule_trigger_log l JOIN cw_rule_templates t ON t.id = l.template_id
--     WHERE t.is_active = false AND l.reset_at IS NULL)                AS paused_rules_with_open_log;
-- -- 0 / 0 on 2026-11-27. Anything else is closed by the first tick's sweep.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.cw_rule_template_schedules') IS NOT NULL THEN
    RAISE EXCEPTION '041 must not be re-run after 042: it would replace cw_rule_switch and cw_rules_tick with their older versions. Re-run 042 instead.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- A) cw_rule_templates
-- ---------------------------------------------------------------------------
ALTER TABLE public.cw_rule_templates
  ADD COLUMN IF NOT EXISTS trigger_kind text NOT NULL DEFAULT 'sensor',
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id),
  ADD COLUMN IF NOT EXISTS auto_start_at timestamptz,
  ADD COLUMN IF NOT EXISTS auto_pause_at timestamptz,
  ADD COLUMN IF NOT EXISTS on_auto_pause_start_template_id bigint
      REFERENCES public.cw_rule_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS status_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS status_reason text,
  ADD COLUMN IF NOT EXISTS status_changed_by_user uuid
      REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS status_changed_by_template bigint
      REFERENCES public.cw_rule_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_action_activated_at timestamptz;

ALTER TABLE public.cw_rule_templates
  DROP CONSTRAINT IF EXISTS cw_rule_templates_trigger_kind_check,
  DROP CONSTRAINT IF EXISTS cw_rule_templates_schedule_org_check,
  DROP CONSTRAINT IF EXISTS cw_rule_templates_chain_not_self_check,
  DROP CONSTRAINT IF EXISTS cw_rule_templates_status_reason_check,
  DROP CONSTRAINT IF EXISTS cw_rule_templates_auto_dates_check;

ALTER TABLE public.cw_rule_templates
  ADD CONSTRAINT cw_rule_templates_trigger_kind_check
      CHECK (trigger_kind IN ('sensor', 'schedule')),
  -- A schedule rule has no devices to derive its organization from.
  ADD CONSTRAINT cw_rule_templates_schedule_org_check
      CHECK (trigger_kind <> 'schedule' OR org_id IS NOT NULL),
  ADD CONSTRAINT cw_rule_templates_chain_not_self_check
      CHECK (on_auto_pause_start_template_id IS DISTINCT FROM id),
  ADD CONSTRAINT cw_rule_templates_status_reason_check
      CHECK (status_reason IS NULL OR status_reason IN
             ('manual', 'auto_start', 'auto_pause', 'chain', 'rule_action')),
  -- Either order is meaningful (start then pause; or pause, then start again
  -- later), but the two dates can never be the same instant.
  ADD CONSTRAINT cw_rule_templates_auto_dates_check
      CHECK (auto_start_at IS NULL OR auto_pause_at IS NULL OR auto_start_at <> auto_pause_at);

-- The tick's two lookups: only rules that have a date are in these indexes.
CREATE INDEX IF NOT EXISTS cw_rule_templates_auto_start_at_idx
    ON public.cw_rule_templates (auto_start_at) WHERE auto_start_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS cw_rule_templates_auto_pause_at_idx
    ON public.cw_rule_templates (auto_pause_at) WHERE auto_pause_at IS NOT NULL;
-- "Which rules start this one when they auto-pause?" (status tooltip, delete).
CREATE INDEX IF NOT EXISTS cw_rule_templates_chain_target_idx
    ON public.cw_rule_templates (on_auto_pause_start_template_id)
    WHERE on_auto_pause_start_template_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- B) cw_rule_status_events
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cw_rule_status_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  template_id bigint NOT NULL REFERENCES public.cw_rule_templates(id) ON DELETE CASCADE,
  at          timestamptz NOT NULL DEFAULT now(),
  -- The direction that was asked for: true = start, false = pause.
  activated   boolean NOT NULL,
  -- changed: it happened. suppressed: cooldown. forbidden: the same-organization
  -- guard refused it. error: the tick caught an exception (see detail).
  outcome     text NOT NULL CHECK (outcome IN ('changed', 'suppressed', 'forbidden', 'error')),
  reason      text NOT NULL CHECK (reason IN
              ('manual', 'auto_start', 'auto_pause', 'chain', 'rule_action')),
  by_user     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  by_template bigint REFERENCES public.cw_rule_templates(id) ON DELETE SET NULL,
  detail      text,
  -- `at` is when the change counts from (a date-driven change: its date);
  -- this is when the row was written, so a late tick stays visible.
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cw_rule_status_events_template_at_idx
    ON public.cw_rule_status_events (template_id, at DESC);

ALTER TABLE public.cw_rule_status_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cw_rule_status_events FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- C) Organizations a rule touches, and the switch
-- ---------------------------------------------------------------------------
-- Every organization the rule touches: its assigned devices' organizations,
-- plus its own org_id (schedule rules). A device without an organization
-- yields NULL, which no guard accepts.
CREATE OR REPLACE FUNCTION public.cw_rule_target_orgs(p_template_id bigint)
RETURNS SETOF uuid
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
    AS $$
  SELECT d.org_id
    FROM cw_device_rule_assignments a
    JOIN cw_devices d ON d.dev_eui = a.dev_eui
   WHERE a.template_id = p_template_id
  UNION
  SELECT t.org_id
    FROM cw_rule_templates t
   WHERE t.id = p_template_id AND t.org_id IS NOT NULL;
$$;

-- The rule's organization when it touches exactly one, else NULL.
CREATE OR REPLACE FUNCTION public.cw_rule_single_org(p_template_id bigint)
RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
    AS $$
  SELECT CASE WHEN count(*) = 1 THEN (array_agg(o.org))[1] END
    FROM cw_rule_target_orgs(p_template_id) AS o(org);
$$;

-- Starts (p_activate = true) or pauses a rule.
--   p_now          the moment the change counts from (default: now)
--   p_reason       manual | auto_start | auto_pause | chain | rule_action
--   p_by_user      the person, for 'manual'
--   p_by_template  the rule that caused it, for 'chain' and 'rule_action'
--   p_source_org   that rule's organization (required for 'chain'/'rule_action')
-- Returns changed | noop | suppressed | forbidden | not_found.
-- Never overload this function: RPC callers bind arguments by name.
CREATE OR REPLACE FUNCTION public.cw_rule_switch(
  p_template_id bigint,
  p_activate    boolean,
  p_reason      text,
  p_by_user     uuid DEFAULT NULL,
  p_by_template bigint DEFAULT NULL,
  p_source_org  uuid DEFAULT NULL,
  p_now         timestamptz DEFAULT now()
) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
    AS $$
DECLARE
  t         cw_rule_templates%ROWTYPE;
  v_outcome text;
  v_detail  text;
BEGIN
  IF p_reason IS NULL OR p_reason NOT IN
     ('manual', 'auto_start', 'auto_pause', 'chain', 'rule_action') THEN
    RAISE EXCEPTION 'RULE_SWITCH: unknown reason %', p_reason;
  END IF;
  IF p_activate IS NULL THEN
    RAISE EXCEPTION 'RULE_SWITCH: p_activate is required';
  END IF;

  SELECT * INTO t FROM cw_rule_templates WHERE id = p_template_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;

  IF p_reason IN ('rule_action', 'chain') AND (
       p_source_org IS NULL
       OR NOT EXISTS (SELECT 1 FROM cw_rule_target_orgs(p_template_id))
       OR EXISTS (SELECT 1 FROM cw_rule_target_orgs(p_template_id) AS o(org)
                   WHERE o.org IS DISTINCT FROM p_source_org)) THEN
    v_outcome := 'forbidden';
    v_detail  := 'the rule is not wholly inside the organization of the rule that asked';
  ELSIF COALESCE(t.is_active, true) = p_activate THEN
    RETURN 'noop';
  ELSIF p_activate AND p_reason = 'rule_action'
        AND t.last_action_activated_at IS NOT NULL
        AND t.last_action_activated_at > p_now - interval '60 minutes' THEN
    v_outcome := 'suppressed';
    v_detail  := 'a rule action already started this rule within the last 60 minutes';
  END IF;

  IF v_outcome IS NOT NULL THEN
    INSERT INTO cw_rule_status_events
           (template_id, at, activated, outcome, reason, by_user, by_template, detail)
    VALUES (p_template_id, p_now, p_activate, v_outcome, p_reason, p_by_user, p_by_template, v_detail);
    RETURN v_outcome;
  END IF;

  UPDATE cw_rule_templates
     SET is_active                  = p_activate,
         status_changed_at          = p_now,
         status_reason              = p_reason,
         status_changed_by_user     = p_by_user,
         status_changed_by_template = p_by_template,
         last_action_activated_at   = CASE WHEN p_activate AND p_reason = 'rule_action'
                                           THEN p_now ELSE last_action_activated_at END
   WHERE id = p_template_id;

  -- Clean slate in both directions (administrative close: no reset_value).
  UPDATE cw_rule_state
     SET is_triggered  = false,
         last_reset_at = GREATEST(p_now, COALESCE(last_triggered_at, p_now))
   WHERE template_id = p_template_id AND is_triggered;

  UPDATE cw_rule_trigger_log
     SET reset_at = GREATEST(p_now, triggered_at)
   WHERE template_id = p_template_id AND reset_at IS NULL;

  INSERT INTO cw_rule_status_events
         (template_id, at, activated, outcome, reason, by_user, by_template)
  VALUES (p_template_id, p_now, p_activate, 'changed', p_reason, p_by_user, p_by_template);

  RETURN 'changed';
END;
$$;

-- ---------------------------------------------------------------------------
-- D) The tick
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cw_rules_tick(p_now timestamptz DEFAULT now())
RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
    AS $$
DECLARE
  r             record;
  v_chain       bigint;
  v_changed_at  timestamptz;
  v_result      text;
  v_starts      integer := 0;
  v_pauses      integer := 0;
  v_chains      integer := 0;
  v_superseded  integer := 0;
  v_errors      integer := 0;
  v_swept_state integer := 0;
  v_swept_log   integer := 0;
BEGIN
  -- One tick at a time: a slow run must not overlap the next minute's.
  IF NOT pg_try_advisory_xact_lock(hashtext('cw_rules_tick')) THEN
    RETURN jsonb_build_object('skipped', 'another tick is running');
  END IF;

  -- 1 + 2. Due dates, oldest first, so a backlog replays in the order it was
  -- meant to happen (a start at 10:00 and a pause at 11:00 end up paused).
  FOR r IN
    SELECT id, 'start'::text AS kind, auto_start_at AS at
      FROM cw_rule_templates WHERE auto_start_at <= p_now
    UNION ALL
    SELECT id, 'pause'::text, auto_pause_at
      FROM cw_rule_templates WHERE auto_pause_at <= p_now
    ORDER BY at, kind, id
  LOOP
    BEGIN
      IF r.kind = 'start' THEN
        -- Use the date up first; skip if it was edited since the query.
        UPDATE cw_rule_templates SET auto_start_at = NULL
         WHERE id = r.id AND auto_start_at = r.at
        RETURNING status_changed_at INTO v_changed_at;
        IF NOT FOUND THEN
          NULL;
        ELSIF v_changed_at > r.at THEN
          -- Someone started or paused it after this date had passed: that stands.
          INSERT INTO cw_rule_status_events
                 (template_id, at, activated, outcome, reason, detail)
          VALUES (r.id, r.at, true, 'suppressed', 'auto_start',
                  'the rule was started or paused after this date had passed');
          v_superseded := v_superseded + 1;
        ELSE
          v_result := cw_rule_switch(r.id, true, 'auto_start', NULL, NULL, NULL, r.at);
          v_starts := v_starts + 1;
        END IF;
      ELSE
        -- Read the chain target, then use up the date and the chain with it.
        SELECT on_auto_pause_start_template_id, status_changed_at
          INTO v_chain, v_changed_at
          FROM cw_rule_templates
         WHERE id = r.id AND auto_pause_at = r.at
           FOR UPDATE;
        IF FOUND THEN
          UPDATE cw_rule_templates
             SET auto_pause_at = NULL, on_auto_pause_start_template_id = NULL
           WHERE id = r.id;
          IF v_changed_at > r.at THEN
            INSERT INTO cw_rule_status_events
                   (template_id, at, activated, outcome, reason, detail)
            VALUES (r.id, r.at, false, 'suppressed', 'auto_pause',
                    'the rule was started or paused after this date had passed');
            v_superseded := v_superseded + 1;
          ELSE
            v_result := cw_rule_switch(r.id, false, 'auto_pause', NULL, NULL, NULL, r.at);
            v_pauses := v_pauses + 1;
          END IF;
          IF v_chain IS NOT NULL THEN
            v_result := cw_rule_switch(v_chain, true, 'chain', NULL, r.id,
                                       cw_rule_single_org(r.id), r.at);
            v_chains := v_chains + 1;
          END IF;
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- The block above rolled back, including the date it used up. Clear the
      -- date here so a rule that cannot be switched is not retried every minute.
      v_errors := v_errors + 1;
      IF r.kind = 'start' THEN
        UPDATE cw_rule_templates SET auto_start_at = NULL
         WHERE id = r.id AND auto_start_at = r.at;
      ELSE
        UPDATE cw_rule_templates
           SET auto_pause_at = NULL, on_auto_pause_start_template_id = NULL
         WHERE id = r.id AND auto_pause_at = r.at;
      END IF;
      INSERT INTO cw_rule_status_events
             (template_id, at, activated, outcome, reason, detail)
      VALUES (r.id, p_now, r.kind = 'start', 'error',
              CASE WHEN r.kind = 'start' THEN 'auto_start' ELSE 'auto_pause' END,
              left(SQLERRM, 500));
    END;
  END LOOP;

  -- 3. Sweep: no paused rule keeps an open alarm.
  UPDATE cw_rule_state s
     SET is_triggered  = false,
         last_reset_at = GREATEST(p_now, COALESCE(s.last_triggered_at, p_now))
    FROM cw_rule_templates t
   WHERE t.id = s.template_id AND t.is_active = false AND s.is_triggered;
  GET DIAGNOSTICS v_swept_state = ROW_COUNT;

  UPDATE cw_rule_trigger_log l
     SET reset_at = GREATEST(p_now, l.triggered_at)
    FROM cw_rule_templates t
   WHERE t.id = l.template_id AND t.is_active = false AND l.reset_at IS NULL;
  GET DIAGNOSTICS v_swept_log = ROW_COUNT;

  RETURN jsonb_build_object(
    'starts', v_starts, 'pauses', v_pauses, 'chains', v_chains,
    'superseded', v_superseded, 'errors', v_errors,
    'swept_states', v_swept_state, 'swept_logs', v_swept_log);
END;
$$;

REVOKE ALL ON FUNCTION public.cw_rule_target_orgs(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cw_rule_single_org(bigint)  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cw_rule_switch(bigint, boolean, text, uuid, bigint, uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cw_rules_tick(timestamptz)  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cw_rule_switch(bigint, boolean, text, uuid, bigint, uuid, timestamptz)
  TO service_role;

-- PostgREST: pick up the new columns and the cw_rule_switch RPC.
NOTIFY pgrst, 'reload schema';

COMMIT;

-- =============================================================================
-- Step 2 — first tick by hand, then the schedules (run after the COMMIT above)
-- =============================================================================
-- Expect {"starts":0,"pauses":0,"chains":0,"superseded":0,"errors":0,"swept_states":0,"swept_logs":0}.
SELECT public.cw_rules_tick() AS first_tick;

-- cron.schedule with an existing name updates that job, so this is rerunnable.
SELECT cron.schedule('rules-tick-every-minute', '* * * * *', $$SELECT public.cw_rules_tick()$$);
-- A per-minute job writes 1,440 run records a day and nothing else prunes them.
SELECT cron.schedule('rules-tick-prune-daily', '23 3 * * *', $$
  DELETE FROM cron.job_run_details
   WHERE jobid IN (SELECT jobid FROM cron.job WHERE jobname = 'rules-tick-every-minute')
     AND end_time < now() - interval '7 days'
$$);

-- =============================================================================
-- OPS — verification (read-only)
-- =============================================================================
-- SELECT jobname, schedule, active FROM cron.job WHERE jobname LIKE 'rules-%';
-- -- expect the two jobs, active
-- SELECT status, return_message, start_time, end_time - start_time AS took
--   FROM cron.job_run_details
--  WHERE jobid IN (SELECT jobid FROM cron.job WHERE jobname = 'rules-tick-every-minute')
--  ORDER BY start_time DESC LIMIT 5;
-- -- expect "succeeded" every minute, a few milliseconds each
-- SELECT e.at, t.name, e.activated, e.outcome, e.reason, e.detail
--   FROM cw_rule_status_events e JOIN cw_rule_templates t ON t.id = e.template_id
--  ORDER BY e.at DESC LIMIT 20;
-- -- 'error', 'forbidden' and 'suppressed' rows are the ones worth reading
-- SELECT count(*) FROM cw_rule_templates WHERE is_active IS DISTINCT FROM true;
-- -- 0 until someone pauses a rule
--
-- =============================================================================
-- ROLLBACK
-- =============================================================================
-- Stop all automation at once (rules keep the state they have):
--   SELECT cron.unschedule('rules-tick-every-minute');
--   SELECT cron.unschedule('rules-tick-prune-daily');
-- The columns, table and functions can stay: the previous API and app ignore
-- them, and a paused rule simply reads as "inactive" there.
