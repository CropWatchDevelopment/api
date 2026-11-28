-- =============================================================================
-- 042_rule_schedules.sql
-- =============================================================================
-- Date/Time rules: a rule that fires at a time of day, on chosen weekdays, in a
-- time zone, instead of on sensor data. Requires 041. Additive: sensor rules
-- and their alerting are untouched.
--
--  A) cw_rule_template_schedules — one row per Date/Time rule
--     (cw_rule_templates.trigger_kind = 'schedule'): time_of_day (to the
--     minute), days_of_week (ISO: 1 = Monday ... 7 = Sunday), timezone (IANA
--     name, checked against pg_timezone_names) and next_fire_at, the next
--     occurrence as an instant. next_fire_at is NULL while the rule is paused.
--  B) cw_rule_schedule_runs — one row per run: the occurrence, the local day it
--     belongs to, a SNAPSHOT of the rule's actions, the outcome of every switch
--     action and the state of its relay commands. UNIQUE (template_id,
--     local_date): a rule runs at most once per chosen local day.
--  C) cw_rule_schedule_next / cw_rule_schedule_prev — THE time-zone math, in one
--     place:  occurrence = (local date + time of day) AT TIME ZONE zone.
--       * Spring forward (the local time does not exist that day): the run
--         happens once, one hour later on the clock.
--       * Fall back (the local time happens twice): the run happens once, at
--         the second one (standard time).
--       * A zone change moves the instants; the local time stays what the user
--         chose.
--  D) cw_rule_switch — as 041, plus: starting a Date/Time rule computes its
--     next occurrence, pausing it clears next_fire_at.
--  E) cw_rules_tick — as 041, plus Date/Time rules. Dates and schedule runs are
--     merged into ONE list ordered by the time they were meant to happen, so a
--     backlog replays in order. For each due Date/Time rule:
--       1. the run row is written (with the action snapshot) and next_fire_at
--          moves to the next occurrence — before anything is executed, so a
--          failing rule cannot run twice or be retried every minute;
--       2. its rule-switch actions run through cw_rule_switch: "activate /
--          deactivate another rule" first, "deactivate THIS rule" last;
--       3. relay commands are left as relay_status = 'pending' for the alert
--          service (ScheduleRelayRunner), which is the only thing that may talk
--          to a relay.
--     After an outage only the LATEST missed occurrence of a rule runs, and:
--       * a switch never overrides a newer decision (the target was started or
--         paused after the occurrence): outcome 'superseded';
--       * a relay is never actuated more than 10 minutes late: 'missed'.
--     Sweep: pending relay runs older than 10 minutes become 'missed'; a relay
--     run claimed but not finished within 10 minutes becomes 'failed' and is
--     NOT retried (a timed relay pulse must never be sent twice).
--
-- Action types used here are matched by NAME, case-insensitively, and are
-- seeded by 043 (run that one last): RuleActivate, RuleDeactivate
-- (config.targetTemplateId), RuleDeactivateSelf; relay = the existing LoRaWAN.
-- Until 043 runs no rule can have a switch action, so this file changes nothing
-- that is live.
--
-- HOW TO RUN (SQL editor, as postgres): the BEGIN ... COMMIT block, then the
-- read-only checks at the end. Re-runnable.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- A) Schedules
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cw_rule_template_schedules (
  template_id   bigint PRIMARY KEY REFERENCES public.cw_rule_templates(id) ON DELETE CASCADE,
  -- Wall-clock time in `timezone`, to the minute.
  time_of_day   time NOT NULL,
  -- ISO weekdays: 1 = Monday ... 7 = Sunday.
  days_of_week  smallint[] NOT NULL,
  -- IANA name (Asia/Tokyo, America/New_York): never an offset or abbreviation,
  -- which would silently ignore daylight saving time.
  timezone      text NOT NULL,
  -- The next occurrence as an instant; NULL while the rule is paused.
  next_fire_at  timestamptz,
  last_fired_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cw_rule_template_schedules_minute_check
      CHECK (extract(second FROM time_of_day) = 0),
  CONSTRAINT cw_rule_template_schedules_days_check
      CHECK (cardinality(days_of_week) BETWEEN 1 AND 7
             AND days_of_week <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[])
);

CREATE INDEX IF NOT EXISTS cw_rule_template_schedules_next_fire_at_idx
    ON public.cw_rule_template_schedules (next_fire_at) WHERE next_fire_at IS NOT NULL;

ALTER TABLE public.cw_rule_template_schedules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cw_rule_template_schedules FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- B) Runs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cw_rule_schedule_runs (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  template_id      bigint NOT NULL REFERENCES public.cw_rule_templates(id) ON DELETE CASCADE,
  -- The instant the run was meant to happen, and the local day it belongs to.
  occurrence_at    timestamptz NOT NULL,
  local_date       date NOT NULL,
  ran_at           timestamptz NOT NULL DEFAULT now(),
  late_seconds     integer NOT NULL DEFAULT 0,
  -- The rule's actions as they were when it ran: [{id, action_type, type, config}].
  -- A later edit of the rule (which rewrites its action ids) cannot change a run.
  actions          jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- One entry per switch action: {action_id, type, target, outcome}.
  switch_results   jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- none: no relay action. pending: waiting for the alert service. claimed: the
  -- alert service is sending. done / failed: see relay_results. missed: not
  -- sent, because it would have been more than 10 minutes late.
  relay_status     text NOT NULL DEFAULT 'none'
      CHECK (relay_status IN ('none', 'pending', 'claimed', 'done', 'failed', 'missed')),
  relay_claimed_at timestamptz,
  relay_done_at    timestamptz,
  relay_results    jsonb,
  -- Set when the run itself failed (see cw_rules_tick).
  error            text,
  CONSTRAINT cw_rule_schedule_runs_once_per_day UNIQUE (template_id, local_date)
);

CREATE INDEX IF NOT EXISTS cw_rule_schedule_runs_relay_idx
    ON public.cw_rule_schedule_runs (occurrence_at)
    WHERE relay_status IN ('pending', 'claimed');
CREATE INDEX IF NOT EXISTS cw_rule_schedule_runs_template_idx
    ON public.cw_rule_schedule_runs (template_id, occurrence_at DESC);

ALTER TABLE public.cw_rule_schedule_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cw_rule_schedule_runs FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- C) The time-zone math
-- ---------------------------------------------------------------------------
-- The first occurrence strictly after p_after.
CREATE OR REPLACE FUNCTION public.cw_rule_schedule_next(
  p_time  time,
  p_days  smallint[],
  p_tz    text,
  p_after timestamptz
) RETURNS timestamptz
    LANGUAGE sql STABLE SET search_path TO 'public'
    AS $$
  SELECT min(o.occurrence)
    FROM (
      -- One day back to eight ahead in LOCAL days: covers any weekday choice
      -- and the day the zone's offset moves a time across midnight.
      SELECT ((d.day::date + p_time) AT TIME ZONE p_tz) AS occurrence
        FROM generate_series(
               ((p_after AT TIME ZONE p_tz)::date - 1)::timestamp,
               ((p_after AT TIME ZONE p_tz)::date + 8)::timestamp,
               interval '1 day') AS d(day)
       WHERE extract(isodow FROM d.day)::smallint = ANY (p_days)
    ) AS o
   WHERE o.occurrence > p_after;
$$;

-- The latest occurrence at or before p_at.
CREATE OR REPLACE FUNCTION public.cw_rule_schedule_prev(
  p_time time,
  p_days smallint[],
  p_tz   text,
  p_at   timestamptz
) RETURNS timestamptz
    LANGUAGE sql STABLE SET search_path TO 'public'
    AS $$
  SELECT max(o.occurrence)
    FROM (
      SELECT ((d.day::date + p_time) AT TIME ZONE p_tz) AS occurrence
        FROM generate_series(
               ((p_at AT TIME ZONE p_tz)::date - 8)::timestamp,
               ((p_at AT TIME ZONE p_tz)::date + 1)::timestamp,
               interval '1 day') AS d(day)
       WHERE extract(isodow FROM d.day)::smallint = ANY (p_days)
    ) AS o
   WHERE o.occurrence <= p_at;
$$;

-- Checks a schedule when it is written and keeps next_fire_at in step with it.
-- Not fired by the tick or cw_rule_switch, which only write next_fire_at.
CREATE OR REPLACE FUNCTION public.cw_rule_schedule_before_write()
RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
    AS $$
DECLARE
  v_kind   text;
  v_active boolean;
BEGIN
  SELECT trigger_kind, COALESCE(is_active, true) INTO v_kind, v_active
    FROM cw_rule_templates WHERE id = NEW.template_id;
  IF v_kind IS DISTINCT FROM 'schedule' THEN
    RAISE EXCEPTION 'RULE_SCHEDULE: rule % is not a Date/Time rule', NEW.template_id
      USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = NEW.timezone) THEN
    RAISE EXCEPTION 'RULE_SCHEDULE: unknown time zone %', NEW.timezone
      USING ERRCODE = '22023';
  END IF;

  NEW.updated_at := now();
  NEW.next_fire_at := CASE WHEN v_active THEN
      cw_rule_schedule_next(NEW.time_of_day, NEW.days_of_week, NEW.timezone, now()) END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cw_rule_schedule_before_write ON public.cw_rule_template_schedules;
CREATE TRIGGER cw_rule_schedule_before_write
  BEFORE INSERT OR UPDATE OF time_of_day, days_of_week, timezone
  ON public.cw_rule_template_schedules
  FOR EACH ROW EXECUTE FUNCTION public.cw_rule_schedule_before_write();

-- ---------------------------------------------------------------------------
-- D) cw_rule_switch: 041's, plus the Date/Time rule's next occurrence
-- ---------------------------------------------------------------------------
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

  -- A Date/Time rule: running means it has a next occurrence, paused means none.
  IF t.trigger_kind = 'schedule' THEN
    UPDATE cw_rule_template_schedules
       SET next_fire_at = CASE WHEN p_activate THEN
             cw_rule_schedule_next(time_of_day, days_of_week, timezone, p_now) END
     WHERE template_id = p_template_id;
  END IF;

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
-- E) The tick: dates (041) and Date/Time rules
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cw_rules_tick(p_now timestamptz DEFAULT now())
RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
    AS $$
DECLARE
  -- A relay command is not sent later than this after its occurrence.
  c_relay_grace CONSTANT interval := interval '10 minutes';
  r              record;
  a              record;
  v_s            record;
  v_chain        bigint;
  v_changed_at   timestamptz;
  v_occurrence   timestamptz;
  v_actions      jsonb;
  v_results      jsonb;
  v_run_id       bigint;
  v_target       bigint;
  v_outcome      text;
  v_result       text;
  v_starts       integer := 0;
  v_pauses       integer := 0;
  v_chains       integer := 0;
  v_superseded   integer := 0;
  v_errors       integer := 0;
  v_runs         integer := 0;
  v_switches     integer := 0;
  v_relay_missed integer := 0;
  v_relay_failed integer := 0;
  v_swept_state  integer := 0;
  v_swept_log    integer := 0;
BEGIN
  -- One tick at a time: a slow run must not overlap the next minute's.
  IF NOT pg_try_advisory_xact_lock(hashtext('cw_rules_tick')) THEN
    RETURN jsonb_build_object('skipped', 'another tick is running');
  END IF;

  -- Everything that is due, in the order it was meant to happen. A Date/Time
  -- rule appears once, with its LATEST occurrence (older missed ones are not
  -- replayed).
  FOR r IN
    SELECT id, 'start'::text AS kind, auto_start_at AS at
      FROM cw_rule_templates WHERE auto_start_at <= p_now
    UNION ALL
    SELECT id, 'pause'::text, auto_pause_at
      FROM cw_rule_templates WHERE auto_pause_at <= p_now
    UNION ALL
    SELECT s.template_id, 'schedule'::text,
           cw_rule_schedule_prev(s.time_of_day, s.days_of_week, s.timezone, p_now)
      FROM cw_rule_template_schedules s
      JOIN cw_rule_templates t ON t.id = s.template_id
     WHERE s.next_fire_at <= p_now AND t.is_active AND t.trigger_kind = 'schedule'
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

      ELSIF r.kind = 'pause' THEN
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

      ELSE
        -- A Date/Time rule. Re-read it: an earlier item of this tick may have
        -- paused it, and then it does not run.
        SELECT s.time_of_day, s.days_of_week, s.timezone, t.org_id
          INTO v_s
          FROM cw_rule_template_schedules s
          JOIN cw_rule_templates t ON t.id = s.template_id
         WHERE s.template_id = r.id AND s.next_fire_at <= p_now
           AND t.is_active AND t.trigger_kind = 'schedule'
           FOR UPDATE OF s;
        IF FOUND THEN
          v_occurrence := cw_rule_schedule_prev(v_s.time_of_day, v_s.days_of_week, v_s.timezone, p_now);

          -- 1. Move on first, and write the run with what the rule looked like.
          UPDATE cw_rule_template_schedules
             SET next_fire_at  = cw_rule_schedule_next(time_of_day, days_of_week, timezone, p_now),
                 last_fired_at = p_now
           WHERE template_id = r.id;

          SELECT COALESCE(jsonb_agg(jsonb_build_object(
                   'id', x.id, 'action_type', x.action_type, 'type', ty.name, 'config', x.config)
                   ORDER BY x.id), '[]'::jsonb)
            INTO v_actions
            FROM cw_rule_template_actions x
            JOIN cw_rule_action_types ty ON ty.id = x.action_type
           WHERE x.template_id = r.id;

          v_run_id := NULL;
          INSERT INTO cw_rule_schedule_runs
                 (template_id, occurrence_at, local_date, ran_at, late_seconds, actions, relay_status)
          VALUES (r.id, v_occurrence, (v_occurrence AT TIME ZONE v_s.timezone)::date, p_now,
                  GREATEST(0, extract(epoch FROM p_now - v_occurrence)::integer), v_actions,
                  CASE WHEN NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_actions) e
                                         WHERE lower(e->>'type') = 'lorawan') THEN 'none'
                       WHEN p_now - v_occurrence > c_relay_grace THEN 'missed'
                       ELSE 'pending' END)
          ON CONFLICT (template_id, local_date) DO NOTHING
          RETURNING id INTO v_run_id;

          -- No row: this local day already has its run (the time was edited
          -- after today's run). Once a day means once.
          IF v_run_id IS NOT NULL THEN
            v_runs := v_runs + 1;
            IF EXISTS (SELECT 1 FROM cw_rule_schedule_runs
                        WHERE id = v_run_id AND relay_status = 'missed') THEN
              v_relay_missed := v_relay_missed + 1;
            END IF;

            -- 2. Switch actions: other rules first, this rule last.
            v_results := '[]'::jsonb;
            FOR a IN
              SELECT (e->>'id')::bigint AS id, lower(e->>'type') AS type,
                     e->'config'->>'targetTemplateId' AS target
                FROM jsonb_array_elements(v_actions) e
               WHERE lower(e->>'type') IN ('ruleactivate', 'ruledeactivate', 'ruledeactivateself')
               ORDER BY (lower(e->>'type') = 'ruledeactivateself'), (e->>'id')::bigint
            LOOP
              v_target := CASE WHEN a.type = 'ruledeactivateself' THEN r.id
                               WHEN a.target ~ '^[0-9]{1,18}$' THEN a.target::bigint END;
              IF v_target IS NULL THEN
                v_outcome := 'invalid';
              ELSE
                SELECT status_changed_at INTO v_changed_at
                  FROM cw_rule_templates WHERE id = v_target;
                IF v_changed_at > v_occurrence THEN
                  -- The target was started or paused after this run was due.
                  v_outcome := 'superseded';
                  v_superseded := v_superseded + 1;
                ELSE
                  -- Counts from the occurrence, so the 60-minute limit and a
                  -- later item of this tick see it at its real place in time.
                  v_outcome := cw_rule_switch(v_target, a.type = 'ruleactivate', 'rule_action',
                                              NULL, r.id, v_s.org_id, v_occurrence);
                  IF v_outcome = 'changed' THEN v_switches := v_switches + 1; END IF;
                END IF;
              END IF;
              v_results := v_results || jsonb_build_object(
                'action_id', a.id, 'type', a.type, 'target', v_target, 'outcome', v_outcome);
            END LOOP;

            UPDATE cw_rule_schedule_runs SET switch_results = v_results WHERE id = v_run_id;
          END IF;
        END IF;
      END IF;

    EXCEPTION WHEN OTHERS THEN
      -- The block above rolled back, including the date or occurrence it used
      -- up. Use it up here so a failing rule is not retried every minute.
      v_errors := v_errors + 1;
      IF r.kind = 'start' THEN
        UPDATE cw_rule_templates SET auto_start_at = NULL
         WHERE id = r.id AND auto_start_at = r.at;
      ELSIF r.kind = 'pause' THEN
        UPDATE cw_rule_templates
           SET auto_pause_at = NULL, on_auto_pause_start_template_id = NULL
         WHERE id = r.id AND auto_pause_at = r.at;
      ELSE
        UPDATE cw_rule_template_schedules
           SET next_fire_at = COALESCE(
                 cw_rule_schedule_next(time_of_day, days_of_week, timezone, p_now),
                 p_now + interval '1 day')
         WHERE template_id = r.id AND next_fire_at <= p_now;
      END IF;
      INSERT INTO cw_rule_status_events
             (template_id, at, activated, outcome, reason, detail)
      VALUES (r.id, p_now, r.kind = 'start', 'error',
              CASE r.kind WHEN 'start' THEN 'auto_start'
                          WHEN 'pause' THEN 'auto_pause'
                          ELSE 'rule_action' END,
              left(CASE WHEN r.kind = 'schedule' THEN 'schedule run failed: ' ELSE '' END
                   || SQLERRM, 500));
    END;
  END LOOP;

  -- Sweep 1: no paused rule keeps an open alarm.
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

  -- Sweep 2: a relay command nobody picked up in time is not sent any more.
  WITH missed AS (
    UPDATE cw_rule_schedule_runs
       SET relay_status = 'missed', relay_done_at = p_now
     WHERE relay_status = 'pending' AND occurrence_at < p_now - c_relay_grace
    RETURNING 1)
  SELECT v_relay_missed + count(*) INTO v_relay_missed FROM missed;

  -- Sweep 3: a relay run that was claimed and never finished is NOT retried:
  -- nobody knows how far it got, and a timed pulse must never be sent twice.
  WITH failed AS (
    UPDATE cw_rule_schedule_runs
       SET relay_status = 'failed', relay_done_at = p_now,
           relay_results = COALESCE(relay_results, '[]'::jsonb) || jsonb_build_object(
             'status', 'failed', 'reason', 'claimed by the alert service but never finished')
     WHERE relay_status = 'claimed' AND relay_claimed_at < p_now - c_relay_grace
    RETURNING 1)
  SELECT count(*) INTO v_relay_failed FROM failed;

  RETURN jsonb_build_object(
    'starts', v_starts, 'pauses', v_pauses, 'chains', v_chains,
    'superseded', v_superseded, 'errors', v_errors,
    'schedule_runs', v_runs, 'switches', v_switches,
    'relays_missed', v_relay_missed, 'relays_failed', v_relay_failed,
    'swept_states', v_swept_state, 'swept_logs', v_swept_log);
END;
$$;

REVOKE ALL ON FUNCTION public.cw_rule_schedule_next(time, smallint[], text, timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cw_rule_schedule_prev(time, smallint[], text, timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cw_rule_schedule_before_write() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cw_rule_switch(bigint, boolean, text, uuid, bigint, uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cw_rules_tick(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cw_rule_switch(bigint, boolean, text, uuid, bigint, uuid, timestamptz)
  TO service_role;

-- PostgREST: pick up the new tables.
NOTIFY pgrst, 'reload schema';

COMMIT;

-- =============================================================================
-- OPS — verification (read-only; run after the COMMIT)
-- =============================================================================
-- -- The time-zone math on this server. Expect exactly these instants (UTC):
-- SELECT
--   cw_rule_schedule_next('09:00', '{1,2,3,4,5,6,7}', 'Asia/Tokyo',       '2026-12-01 00:00:00+00') AS tokyo,       -- 2026-12-02 00:00:00+00
--   cw_rule_schedule_next('02:30', '{1,2,3,4,5,6,7}', 'America/New_York', '2027-03-14 05:00:00+00') AS spring_gap,  -- 2027-03-14 07:30:00+00 (03:30 EDT)
--   cw_rule_schedule_next('01:30', '{1,2,3,4,5,6,7}', 'America/New_York', '2026-11-01 04:00:00+00') AS fall_back;   -- 2026-11-01 06:30:00+00 (the second 01:30, EST), once
-- -- The tick still runs every minute and reports zeros while nothing is due:
-- SELECT public.cw_rules_tick();
-- SELECT status, return_message, start_time FROM cron.job_run_details
--  WHERE jobid IN (SELECT jobid FROM cron.job WHERE jobname = 'rules-tick-every-minute')
--  ORDER BY start_time DESC LIMIT 3;
-- -- Later, when Date/Time rules exist:
-- SELECT t.name, s.time_of_day, s.days_of_week, s.timezone, s.next_fire_at, s.last_fired_at
--   FROM cw_rule_template_schedules s JOIN cw_rule_templates t ON t.id = s.template_id;
-- SELECT t.name, r.occurrence_at, r.late_seconds, r.switch_results, r.relay_status, r.error
--   FROM cw_rule_schedule_runs r JOIN cw_rule_templates t ON t.id = r.template_id
--  ORDER BY r.occurrence_at DESC LIMIT 20;
--
-- =============================================================================
-- ROLLBACK
-- =============================================================================
-- Stop Date/Time rules only (dates and the sweep keep working): re-run the
-- cw_rule_switch and cw_rules_tick definitions from 041. The two tables can
-- stay; nothing else reads them.
-- Stop all automation: SELECT cron.unschedule('rules-tick-every-minute');
