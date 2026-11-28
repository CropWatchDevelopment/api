-- =============================================================================
-- 044_rule_resend.sql
-- =============================================================================
-- Re-send: while an alarm stays open, a rule may send its alert again every N
-- reports (N >= 3), up to a maximum number of times per alarm. Requires 041.
-- (The same statements are kept in the alert service repo as
-- LavinMQ-to-Alert/supabase-migrations/005_rule_resend.sql: run ONE of them.)
--
-- Additive, and OFF for every rule until someone turns it on: nothing re-sends
-- while cw_rule_templates.resend_after_reports is NULL, which is the default.
--
--  A) cw_rule_templates
--       resend_after_reports  NULL = off; otherwise 3..1000 reports
--       resend_max            how many re-sends one alarm gets (default 5, 1..50)
--     Only reports that still break the alert threshold are counted (the alert
--     service decides; this file only stores the two settings).
--     A Date/Time rule has no reports, so it cannot have a re-send setting.
--  B) cw_rule_state (one row per device and rule), the counters of the open alarm
--       reports_since_send    matching reports since the alert or the last re-send
--       resend_count          re-sends this alarm has had
--       last_counted_at       the newest reading that was counted: a reading at or
--                             before it is never counted twice (retry, redelivery)
--       last_resend_at        when the last re-send went out; also the key of its
--                             delivery records
--     The alert service zeroes them when the alarm triggers.
--  C) cw_rule_action_deliveries.mode also allows 'repeat'. A re-send is its own
--     delivery episode (episode_at = the reading it was sent for), so the unique
--     key (dev_eui, template_id, mode, episode_at, action_id) is unchanged and a
--     reading that is processed twice cannot send a re-send twice.
--
-- ORDER: run this BEFORE deploying the alert service with re-send. The alert
-- service checks at start-up whether these columns exist and only then reads
-- them, so the order cannot stop alerting either way: without this file it
-- simply never re-sends.
--
-- HOW TO RUN (SQL editor, as postgres): the BEGIN ... COMMIT block, then the
-- read-only checks at the end. Re-runnable.
--
-- OFF SWITCH (all rules at once, takes effect with the next reading):
--   UPDATE cw_rule_templates SET resend_after_reports = NULL
--    WHERE resend_after_reports IS NOT NULL;
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- A) The two settings
-- ---------------------------------------------------------------------------
ALTER TABLE public.cw_rule_templates
  ADD COLUMN IF NOT EXISTS resend_after_reports integer,
  ADD COLUMN IF NOT EXISTS resend_max integer NOT NULL DEFAULT 5;

ALTER TABLE public.cw_rule_templates
  DROP CONSTRAINT IF EXISTS cw_rule_templates_resend_after_reports_check,
  DROP CONSTRAINT IF EXISTS cw_rule_templates_resend_max_check,
  DROP CONSTRAINT IF EXISTS cw_rule_templates_resend_sensor_only_check;

ALTER TABLE public.cw_rule_templates
  -- Fewer than 3 would re-send on nearly every report.
  ADD CONSTRAINT cw_rule_templates_resend_after_reports_check
      CHECK (resend_after_reports IS NULL OR resend_after_reports BETWEEN 3 AND 1000),
  ADD CONSTRAINT cw_rule_templates_resend_max_check
      CHECK (resend_max BETWEEN 1 AND 50),
  ADD CONSTRAINT cw_rule_templates_resend_sensor_only_check
      CHECK (trigger_kind <> 'schedule' OR resend_after_reports IS NULL);

-- ---------------------------------------------------------------------------
-- B) The counters of an open alarm
-- ---------------------------------------------------------------------------
ALTER TABLE public.cw_rule_state
  ADD COLUMN IF NOT EXISTS reports_since_send integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS resend_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_counted_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_resend_at timestamptz;

ALTER TABLE public.cw_rule_state
  DROP CONSTRAINT IF EXISTS cw_rule_state_resend_counters_check;
ALTER TABLE public.cw_rule_state
  ADD CONSTRAINT cw_rule_state_resend_counters_check
      CHECK (reports_since_send >= 0 AND resend_count >= 0);

-- ---------------------------------------------------------------------------
-- C) A re-send is its own delivery episode
-- ---------------------------------------------------------------------------
ALTER TABLE public.cw_rule_action_deliveries
  DROP CONSTRAINT IF EXISTS cw_rule_action_deliveries_mode_check;
ALTER TABLE public.cw_rule_action_deliveries
  ADD CONSTRAINT cw_rule_action_deliveries_mode_check
      CHECK (mode = ANY (ARRAY['trigger'::text, 'reset'::text, 'repeat'::text]));

-- PostgREST: pick up the new columns.
NOTIFY pgrst, 'reload schema';

COMMIT;

-- =============================================================================
-- OPS — verification (read-only)
-- =============================================================================
-- -- Off everywhere right after the run: expect 0.
-- SELECT count(*) FROM cw_rule_templates WHERE resend_after_reports IS NOT NULL;
-- -- The counters exist and are zero: expect one row, all zeros / NULLs.
-- SELECT max(reports_since_send) AS max_since, max(resend_count) AS max_count,
--        count(last_counted_at) AS counted, count(last_resend_at) AS resent
--   FROM cw_rule_state;
-- -- Later, with re-send in use: the re-sends of the last day.
-- SELECT d.dev_eui, t.name, d.episode_at, d.status, d.delivered_to, d.last_error
--   FROM cw_rule_action_deliveries d JOIN cw_rule_templates t ON t.id = d.template_id
--  WHERE d.mode = 'repeat' AND d.episode_at > now() - interval '1 day'
--  ORDER BY d.episode_at DESC;
-- -- Which alarms are counting, and how far they are:
-- SELECT s.dev_eui, t.name, t.resend_after_reports, t.resend_max,
--        s.reports_since_send, s.resend_count, s.last_resend_at
--   FROM cw_rule_state s JOIN cw_rule_templates t ON t.id = s.template_id
--  WHERE s.is_triggered AND t.resend_after_reports IS NOT NULL;
--
-- =============================================================================
-- ROLLBACK
-- =============================================================================
-- Use the OFF SWITCH above. The columns can stay: the previous alert service
-- and API never read them. Only if the 'repeat' mode must go as well, and only
-- while no row uses it:
--   DELETE FROM cw_rule_action_deliveries WHERE mode = 'repeat';
--   ALTER TABLE cw_rule_action_deliveries DROP CONSTRAINT cw_rule_action_deliveries_mode_check;
--   ALTER TABLE cw_rule_action_deliveries ADD CONSTRAINT cw_rule_action_deliveries_mode_check
--     CHECK (mode = ANY (ARRAY['trigger'::text, 'reset'::text]));
