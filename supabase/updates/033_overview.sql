-- =============================================================================
-- 033_overview.sql
-- =============================================================================
-- Overview page (GET /v1/overview?range=24h|7d|30d): system-wide counts,
-- activity feed, hourly share of devices reporting, per-location breakdown,
-- notes and reports, served by ONE database call per page view.
--
-- Rule: a page view never reads the telemetry tables (cw_air_data is ~10M
-- rows / 2.5 GB). A pg_cron job reads only the last ~2 hours of telemetry
-- every 10 minutes and keeps two small tables current; the page reads those
-- plus the already-small alert, note and report tables.
--
--  A) cw_device_activity_hourly — uplinks per device per UTC hour. Feeds
--     "data received", "% of expected" and the 24-bar "devices reporting"
--     chart. ~185 active devices x 840 hours (35-day retention) = ~155k
--     narrow rows.
--       * Counted from cw_air_data / cw_soil_data / cw_water_data (one row
--         per uplink), cw_relay_reports (one row per relay uplink, 030 —
--         cw_relay_data holds one overwritten row per device and cannot be
--         counted) and cw_traffic2. cw_traffic2 is an hourly accumulator
--         (one row per device/hour/line, incremented in place), so a traffic
--         camera counts one "uplink" per line bucket per hour: enough for the
--         reporting chart, an undercount for "data received".
--       * Recomputed, not incremented: each run recounts whole hours and
--         overwrites them, so a run that is repeated, overlaps another, or
--         sees late rows within the window never double-counts. No
--         watermark to drift.
--  B) cw_device_status — each device's online/offline state as of the last
--     run, used only to detect transitions. For EVENTS a device is offline
--     after 2x its upload interval without data, so a single late uplink
--     does not log an offline/online pair. The page's online/offline COUNTS
--     do not use this table: cw_overview computes them live with exactly the
--     rule of GET /v1/devices/status (findAllStatus): offline when the last
--     uplink is older than upload_interval, else the type's
--     default_upload_interval.
--  C) cw_device_status_events — the transitions ("went offline", "back
--     online") for the activity feed. last_seen_at = the device's last uplink
--     before it went silent, so the feed can say "last seen 2 h ago" /
--     "back after 34 min". 90-day retention.
--  D) Indexes for the job's time-range scans on the tables that only had
--     (dev_eui, time) indexes, plus cw_rule_trigger_log (dev_eui,
--     triggered_at) for "alerts in this range".
--  E) cw_device_activity_recompute(from, to) — recounts the hours in
--     [from, to) (at most 2 days per call).
--     cw_device_activity_backfill(days) — calls it one day at a time.
--     cw_overview_tick() — the 10-minute job: recompute the current and
--     previous hour, then diff device status and log transitions. Guarded by
--     an advisory lock so overlapping runs skip instead of racing.
--     cw_overview_prune() — the daily retention job.
--  F) cw_overview(dev_euis, hours, feed_limit) — the page's single read,
--     returning one jsonb object. Alerts come straight from
--     cw_rule_trigger_log / cw_rule_state and reports straight from the
--     `Reports` storage bucket (objects are `<DEV_EUI>/<from>-<to>.pdf`):
--     both are small, so nothing is copied and nothing can fall out of
--     sync. Only the 24-hour chart and uplink totals read table A.
--
-- Authorization is NOT done here: the API resolves the caller's readable
-- devices (AccessService.listAccessibleDevices, canView) and passes their
-- EUIs; gateways are counted by the API. EXECUTE is service_role only (005
-- posture). Tables: RLS on, no policies, no anon/authenticated grants.
-- New tables cascade from cw_devices like every other dev_eui table:
-- ON UPDATE CASCADE (DevicesService.replaceDevice) and ON DELETE CASCADE
-- (delete_device, 028, needs no change).
--
-- HOW TO RUN (SQL editor, as postgres):
--   1. The BEGIN ... COMMIT block: tables, indexes, functions. Short: it
--      briefly holds cw_devices against writes (FK creation), so it does
--      NOT include the backfill.
--   2. Step 2: the 31-day backfill (~1 s per day measured on prod on
--      2026-10-15, so ~30-60 s; reads the telemetry time indexes one day at a
--      time and writes only the new table). If the SQL editor times out, the
--      committed DDL stays: run Step 2 again on its own (it is idempotent).
--   3. Step 3: the first tick (seeds cw_device_status without logging
--      events) and the two cron jobs.
--   Then deploy the API, then the app. Patch database.types.ts (api +
--   CropWatch): three tables, five Functions.
-- Additive and idempotent. Verification and rollback: bottom of file.
-- =============================================================================

BEGIN;

-- The FKs below briefly hold cw_devices against writes (the data handler
-- updates last_data_updated_at on every uplink). If something else holds it,
-- fail fast and rerun rather than queue every writer behind this script.
SET LOCAL lock_timeout = '10s';

-- A) cw_device_activity_hourly ----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cw_device_activity_hourly (
  dev_eui text        NOT NULL
                      REFERENCES public.cw_devices (dev_eui) ON UPDATE CASCADE ON DELETE CASCADE,
  hour    timestamptz NOT NULL,   -- start of the UTC hour
  uplinks integer     NOT NULL CHECK (uplinks > 0),
  PRIMARY KEY (dev_eui, hour)
);

ALTER TABLE public.cw_device_activity_hourly ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cw_device_activity_hourly FROM anon, authenticated;

COMMENT ON TABLE public.cw_device_activity_hourly IS
  'Uplinks per device per UTC hour, recounted every 10 min by cw_overview_tick (033). 35-day retention.';

-- B) cw_device_status ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cw_device_status (
  dev_eui      text        PRIMARY KEY
                           REFERENCES public.cw_devices (dev_eui) ON UPDATE CASCADE ON DELETE CASCADE,
  is_online    boolean     NOT NULL,   -- heard within 2x the upload interval
  changed_at   timestamptz NOT NULL,   -- when is_online last flipped (or the first run)
  last_seen_at timestamptz             -- last uplink as of that flip
);

ALTER TABLE public.cw_device_status ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cw_device_status FROM anon, authenticated;

COMMENT ON TABLE public.cw_device_status IS
  'Online/offline state per device as of the last cw_overview_tick (033), used to detect transitions. Not the live status.';

-- C) cw_device_status_events ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cw_device_status_events (
  id           bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dev_eui      text        NOT NULL
                           REFERENCES public.cw_devices (dev_eui) ON UPDATE CASCADE ON DELETE CASCADE,
  occurred_at  timestamptz NOT NULL,   -- offline: when the 2x window ran out; online: the uplink that ended it
  is_online    boolean     NOT NULL,   -- false = went offline, true = back online
  last_seen_at timestamptz             -- last uplink before the device went silent
);

CREATE INDEX IF NOT EXISTS cw_device_status_events_dev_eui_occurred_at_idx
  ON public.cw_device_status_events (dev_eui, occurred_at DESC);

ALTER TABLE public.cw_device_status_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cw_device_status_events FROM anon, authenticated;

COMMENT ON TABLE public.cw_device_status_events IS
  'Device went-offline / back-online transitions for the overview activity feed (033). 90-day retention.';

-- D) indexes ------------------------------------------------------------------------
-- The job scans the last two hours of each telemetry table by time. air and
-- soil already have created_at indexes; these three only had (dev_eui, time)
-- ones, which a time-only range cannot use. All three tables are small, so
-- the builds take well under a second.
CREATE INDEX IF NOT EXISTS cw_water_data_created_at_idx
  ON public.cw_water_data (created_at);
CREATE INDEX IF NOT EXISTS cw_traffic2_traffic_hour_idx
  ON public.cw_traffic2 (traffic_hour);
CREATE INDEX IF NOT EXISTS cw_relay_reports_reported_at_idx
  ON public.cw_relay_reports (reported_at);

-- Alerts per device in a time range (the existing unique key has template_id
-- in the middle).
CREATE INDEX IF NOT EXISTS cw_rule_trigger_log_dev_eui_triggered_at_idx
  ON public.cw_rule_trigger_log (dev_eui, triggered_at DESC);

-- E) job functions --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cw_device_activity_recompute(
  p_from timestamptz,
  p_to   timestamptz
) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
    AS $$
DECLARE
  v_from timestamptz := date_trunc('hour', p_from);
  v_n    integer;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from THEN
    RAISE EXCEPTION 'INVALID_RANGE';
  END IF;
  IF p_to - v_from > interval '2 days' THEN
    RAISE EXCEPTION 'RANGE_TOO_LARGE';  -- use cw_device_activity_backfill
  END IF;

  -- p_to may fall inside an hour: that hour gets its count so far and is
  -- completed by a later run (the tick always recounts the previous hour).
  WITH counts AS (
    SELECT dev_eui::text AS dev_eui, date_trunc('hour', created_at) AS hour, count(*) AS n
      FROM cw_air_data
     WHERE created_at >= v_from AND created_at < p_to
     GROUP BY 1, 2
    UNION ALL
    SELECT dev_eui::text, date_trunc('hour', created_at), count(*)
      FROM cw_soil_data
     WHERE created_at >= v_from AND created_at < p_to
     GROUP BY 1, 2
    UNION ALL
    SELECT dev_eui::text, date_trunc('hour', created_at), count(*)
      FROM cw_water_data
     WHERE created_at >= v_from AND created_at < p_to
     GROUP BY 1, 2
    UNION ALL
    SELECT dev_eui, date_trunc('hour', reported_at), count(*)
      FROM cw_relay_reports
     WHERE reported_at >= v_from AND reported_at < p_to
     GROUP BY 1, 2
    UNION ALL
    -- One row per (hour, line): see the header.
    SELECT dev_eui::text, traffic_hour, count(*)
      FROM cw_traffic2
     WHERE traffic_hour >= v_from AND traffic_hour < p_to
     GROUP BY 1, 2
  ),
  merged AS (
    SELECT c.dev_eui, c.hour, sum(c.n)::integer AS uplinks
      FROM counts c
     -- Telemetry for an EUI that is not (or no longer) a device would fail
     -- the FK and abort the whole run.
     WHERE EXISTS (SELECT 1 FROM cw_devices d WHERE d.dev_eui = c.dev_eui)
     GROUP BY c.dev_eui, c.hour
  )
  INSERT INTO cw_device_activity_hourly AS a (dev_eui, hour, uplinks)
  SELECT dev_eui, hour, uplinks FROM merged
  ON CONFLICT (dev_eui, hour) DO UPDATE
     SET uplinks = EXCLUDED.uplinks
   WHERE a.uplinks IS DISTINCT FROM EXCLUDED.uplinks;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

CREATE OR REPLACE FUNCTION public.cw_device_activity_backfill(
  p_days integer DEFAULT 31
) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
    AS $$
DECLARE
  v_end   timestamptz := date_trunc('hour', now());
  v_day   timestamptz;
  v_total integer := 0;
BEGIN
  IF p_days IS NULL OR p_days < 1 OR p_days > 35 THEN
    RAISE EXCEPTION 'INVALID_DAYS';
  END IF;

  -- Oldest day first; the current partial hour is left to the tick.
  FOR v_day IN
    SELECT generate_series(v_end - p_days * interval '1 day', v_end - interval '1 day', interval '1 day')
  LOOP
    v_total := v_total + cw_device_activity_recompute(v_day, v_day + interval '1 day');
  END LOOP;

  RETURN v_total;
END;
$$;

CREATE OR REPLACE FUNCTION public.cw_overview_tick() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
    AS $$
DECLARE
  v_now      timestamptz := now();
  v_activity integer;
  v_events   integer;
BEGIN
  -- A run still in progress (or a manual run) owns the lock: skip, the next
  -- run recounts the same hours anyway.
  IF NOT pg_try_advisory_xact_lock(hashtext('cw_overview_tick')) THEN
    RETURN jsonb_build_object('skipped', true);
  END IF;

  -- 1) Uplinks: the previous hour (now complete) and the current one.
  v_activity := cw_device_activity_recompute(date_trunc('hour', v_now) - interval '1 hour', v_now);

  -- 2) Status transitions. All CTEs read the table as it was before the
  --    upsert, so `changed` compares against the previous run.
  WITH cur AS (
    SELECT d.dev_eui::text AS dev_eui,
           d.last_data_updated_at AS last_seen,
           coalesce(nullif(d.upload_interval, 0), t.default_upload_interval) AS iv
      FROM cw_devices d
      LEFT JOIN cw_device_type t ON t.id = d.type
  ),
  st AS (
    SELECT dev_eui, last_seen,
           coalesce(last_seen >= v_now - make_interval(secs => 2 * iv * 60), false) AS is_online,
           -- When the 2x window ran out (never in the future).
           least(coalesce(last_seen + make_interval(secs => 2 * iv * 60), v_now), v_now) AS offline_at
      FROM cur
  ),
  changed AS (
    SELECT st.dev_eui, st.is_online, st.last_seen, st.offline_at,
           s.last_seen_at AS prev_last_seen
      FROM st
      JOIN cw_device_status s ON s.dev_eui = st.dev_eui
     WHERE s.is_online IS DISTINCT FROM st.is_online
  ),
  ev AS (
    INSERT INTO cw_device_status_events (dev_eui, occurred_at, is_online, last_seen_at)
    SELECT dev_eui,
           CASE WHEN is_online THEN coalesce(last_seen, v_now) ELSE offline_at END,
           is_online,
           -- Back online: the last uplink before the silence, as stored when
           -- it went offline.
           CASE WHEN is_online THEN prev_last_seen ELSE last_seen END
      FROM changed
    RETURNING 1
  ),
  up AS (
    -- A device without a row (new, or the very first run) is stored without
    -- an event: there is no previous state to compare with.
    INSERT INTO cw_device_status AS s (dev_eui, is_online, changed_at, last_seen_at)
    SELECT dev_eui, is_online,
           CASE WHEN is_online THEN coalesce(last_seen, v_now) ELSE offline_at END,
           last_seen
      FROM st
    ON CONFLICT (dev_eui) DO UPDATE
       SET is_online    = EXCLUDED.is_online,
           changed_at   = EXCLUDED.changed_at,
           last_seen_at = EXCLUDED.last_seen_at
     WHERE s.is_online IS DISTINCT FROM EXCLUDED.is_online
    RETURNING 1
  )
  SELECT count(*) INTO v_events FROM ev;

  RETURN jsonb_build_object('activity_rows', v_activity, 'status_events', v_events);
END;
$$;

CREATE OR REPLACE FUNCTION public.cw_overview_prune() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
    AS $$
DECLARE
  v_activity integer;
  v_events   integer;
BEGIN
  -- 35 days: the 30-day range plus margin.
  DELETE FROM cw_device_activity_hourly WHERE hour < now() - interval '35 days';
  GET DIAGNOSTICS v_activity = ROW_COUNT;

  DELETE FROM cw_device_status_events WHERE occurred_at < now() - interval '90 days';
  GET DIAGNOSTICS v_events = ROW_COUNT;

  RETURN jsonb_build_object('activity_rows', v_activity, 'status_events', v_events);
END;
$$;

-- F) cw_overview ----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cw_overview(
  p_dev_euis   text[],
  p_hours      integer DEFAULT 24,
  p_feed_limit integer DEFAULT 20
) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
    AS $$
DECLARE
  v_now        timestamptz := now();
  v_hour       timestamptz := date_trunc('hour', now());   -- start of the current, partial hour
  v_since      timestamptz;
  v_prev_since timestamptz;
  v_head_share numeric;     -- share of the first hourly bucket that lies inside the range
  v_days       integer;
  v_result     jsonb;
BEGIN
  IF p_dev_euis IS NULL THEN
    RAISE EXCEPTION 'DEV_EUIS_REQUIRED';
  END IF;
  IF p_hours IS NULL OR p_hours < 1 OR p_hours > 744 THEN
    RAISE EXCEPTION 'INVALID_HOURS';
  END IF;
  IF p_feed_limit IS NULL OR p_feed_limit < 1 OR p_feed_limit > 50 THEN
    RAISE EXCEPTION 'INVALID_FEED_LIMIT';
  END IF;

  v_since      := v_now - p_hours * interval '1 hour';
  v_prev_since := v_since - p_hours * interval '1 hour';
  v_head_share := extract(epoch FROM date_trunc('hour', v_since) + interval '1 hour' - v_since) / 3600;
  -- Rolling 24-hour periods ending at v_hour that fit the range.
  v_days       := greatest(1, p_hours / 24);

  WITH
  devs AS (
    SELECT d.dev_eui::text AS dev_eui,
           d.name,
           d.location_id,
           l.name::text AS location_name,
           d.last_data_updated_at AS last_seen,
           coalesce(nullif(d.upload_interval, 0), t.default_upload_interval) AS iv,
           coalesce(t.data_table_v2, '') AS data_table,
           -- Same rule as GET /v1/devices/status (findAllStatus).
           coalesce(v_now - d.last_data_updated_at
                      <= make_interval(secs => coalesce(nullif(d.upload_interval, 0), t.default_upload_interval) * 60),
                    false) AS online,
           coalesce(d.battery_level < 15, false) AS low_battery
      FROM cw_devices d
      LEFT JOIN cw_device_type t ON t.id = d.type
      LEFT JOIN cw_locations l ON l.location_id = d.location_id
     WHERE d.dev_eui = ANY (p_dev_euis)
  ),
  totals AS (
    SELECT count(*)                                  AS total,
           count(*) FILTER (WHERE online)            AS online,
           count(*) FILTER (WHERE low_battery)       AS low_battery,
           count(*) FILTER (WHERE low_battery AND online) AS low_battery_online,
           max(last_seen)                            AS last_data_at,
           count(DISTINCT location_id)               AS location_count
      FROM devs
  ),

  -- Alerts --------------------------------------------------------------------------
  -- Episodes triggered in this range or the one before it (for the delta).
  trig AS (
    SELECT g.dev_eui::text AS dev_eui, g.template_id, g.triggered_at, g.reset_at
      FROM cw_rule_trigger_log g
     WHERE g.dev_eui = ANY (p_dev_euis)
       AND g.triggered_at >= v_prev_since
  ),
  -- Episodes resolved in this range (they may have triggered before it).
  resets AS (
    SELECT g.dev_eui::text AS dev_eui, g.template_id, g.triggered_at, g.reset_at
      FROM cw_rule_trigger_log g
     WHERE g.dev_eui = ANY (p_dev_euis)
       AND g.reset_at >= v_since
  ),
  active AS (
    SELECT s.dev_eui::text AS dev_eui
      FROM cw_rule_state s
     WHERE s.dev_eui = ANY (p_dev_euis)
       AND s.is_triggered
  ),
  loc_alerts AS (
    SELECT devs.location_id, count(*) AS n
      FROM trig
      JOIN devs ON devs.dev_eui = trig.dev_eui
     WHERE trig.triggered_at >= v_since
     GROUP BY devs.location_id
  ),

  -- Uplinks -------------------------------------------------------------------------
  -- One pass over the hourly table, folded to (device, 24-hour period) so a
  -- 30-day range never holds raw hourly rows in memory. Periods are rolling
  -- 24-hour bins ending at v_hour; the current partial hour falls in the bin
  -- that starts at v_hour. `head` is the first bucket, which starts before
  -- v_since and so only partly belongs to the range.
  act AS (
    SELECT a.dev_eui,
           date_bin('24 hours', a.hour, v_hour) AS period,
           sum(a.uplinks) AS uplinks,
           coalesce(sum(a.uplinks) FILTER (WHERE a.hour < v_since), 0) AS head,
           min(a.hour) AS first_hour
      FROM cw_device_activity_hourly a
     WHERE a.dev_eui = ANY (p_dev_euis)
       AND a.hour >= date_trunc('hour', v_since)
     GROUP BY 1, 2
  ),
  dev_act AS (
    SELECT dev_eui,
           sum(uplinks) - sum(head) * (1 - v_head_share) AS received,
           min(first_hour) AS first_hour
      FROM act
     GROUP BY dev_eui
  ),
  -- Per device: received vs expected from its upload interval, counted from
  -- its first uplink in the range (so a device installed mid-range is not
  -- short), and capped so a chatty device cannot hide a quiet one.
  delivery AS (
    SELECT coalesce(sum(least(x.received, x.expected)), 0) AS delivered,
           coalesce(sum(x.expected), 0)                    AS expected
      FROM (
        SELECT dev_act.received,
               extract(epoch FROM v_now - greatest(v_since, dev_act.first_hour)) / 60.0 / devs.iv AS expected
          FROM dev_act
          JOIN devs ON devs.dev_eui = dev_act.dev_eui
         WHERE devs.iv > 0
      ) x
  ),
  -- 24 complete hours, oldest first: devices with any uplink in each. The
  -- explicit hour range keeps this an index range scan (joined on hour
  -- alone, the planner reads every retained hour).
  hourly AS (
    SELECT h.hour, coalesce(c.reporting, 0) AS reporting
      FROM generate_series(v_hour - interval '24 hours', v_hour - interval '1 hour', interval '1 hour') AS h(hour)
      LEFT JOIN (
        SELECT a.hour, count(*) AS reporting
          FROM cw_device_activity_hourly a
         WHERE a.dev_eui = ANY (p_dev_euis)
           AND a.hour >= v_hour - interval '24 hours'
           AND a.hour <  v_hour
         GROUP BY a.hour
      ) c ON c.hour = h.hour
  ),
  days AS (
    SELECT p.period, count(act.dev_eui) AS reporting, coalesce(sum(act.uplinks), 0) AS uplinks
      FROM generate_series(v_hour - v_days * interval '24 hours', v_hour - interval '24 hours',
                           interval '24 hours') AS p(period)
      LEFT JOIN act ON act.period = p.period
     GROUP BY p.period
  ),

  -- Device status transitions ---------------------------------------------------------
  dev_events AS (
    SELECT e.dev_eui, e.occurred_at, e.is_online, e.last_seen_at
      FROM cw_device_status_events e
     WHERE e.dev_eui = ANY (p_dev_euis)
       AND e.occurred_at >= v_since
  ),

  -- Reports ---------------------------------------------------------------------------
  -- `Reports` bucket objects are `<DEV_EUI>/<YYYY_MM_DD>-<YYYY_MM_DD>.pdf`.
  rep AS (
    SELECT split_part(o.name, '/', 1) AS dev_eui,
           split_part(o.name, '/', 2) AS file,
           o.created_at
      FROM storage.objects o
     WHERE o.bucket_id = 'Reports'
       AND split_part(o.name, '/', 1) = ANY (p_dev_euis)
       AND lower(o.name) LIKE '%.pdf'
  ),

  -- Feed: newest p_feed_limit per group, merged by the client --------------------------
  feed_alerts AS (
    SELECT * FROM (
      SELECT 'alert_triggered' AS kind, trig.triggered_at AS at, trig.dev_eui, trig.template_id,
             NULL::timestamptz AS triggered_at
        FROM trig WHERE trig.triggered_at >= v_since
      UNION ALL
      SELECT 'alert_resolved', resets.reset_at, resets.dev_eui, resets.template_id,
             resets.triggered_at
        FROM resets
    ) a
    ORDER BY at DESC
    LIMIT p_feed_limit
  ),
  feed_devices AS (
    SELECT * FROM dev_events ORDER BY occurred_at DESC LIMIT p_feed_limit
  ),
  feed_reports AS (
    SELECT * FROM rep WHERE rep.created_at >= v_since ORDER BY created_at DESC LIMIT p_feed_limit
  ),
  feed_data AS (
    -- The latest complete hour, then one rolling 24-hour period per day.
    SELECT * FROM (
      SELECT 'data_hour' AS kind, v_hour AS at, h.reporting, NULL::numeric AS uplinks
        FROM hourly h WHERE h.hour = v_hour - interval '1 hour'
      UNION ALL
      SELECT 'data_day', days.period + interval '24 hours', days.reporting, days.uplinks
        FROM days
    ) d
    ORDER BY at DESC, kind DESC   -- 'data_hour' before the day that ends at the same time
    LIMIT p_feed_limit
  )

  SELECT jsonb_build_object(
    'generated_at', v_now,
    'since',        v_since,
    'devices', (
      SELECT jsonb_build_object(
        'total',          t.total,
        'online',         t.online,
        'offline',        t.total - t.online,
        'low_battery',    t.low_battery,
        'low_battery_online', t.low_battery_online,
        'last_data_at',   t.last_data_at,
        'location_count', t.location_count)
        FROM totals t),
    'locations', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
               'location_id', l.location_id,
               'name',        l.name,
               'total',       l.total,
               'online',      l.online,
               'alerts',      l.alerts)
             ORDER BY l.name NULLS LAST, l.location_id), '[]'::jsonb)
        FROM (
          SELECT g.location_id, g.name, g.total, g.online, coalesce(la.n, 0) AS alerts
            FROM (SELECT location_id,
                         max(location_name) AS name,
                         count(*) AS total,
                         count(*) FILTER (WHERE online) AS online
                    FROM devs
                   GROUP BY location_id) g
            LEFT JOIN loc_alerts la ON la.location_id IS NOT DISTINCT FROM g.location_id
        ) l),
    'types', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('data_table', x.data_table, 'total', x.total)
             ORDER BY x.total DESC, x.data_table), '[]'::jsonb)
        FROM (SELECT data_table, count(*) AS total FROM devs GROUP BY data_table) x),
    'alerts', jsonb_build_object(
      'count',          (SELECT count(*) FROM trig WHERE triggered_at >= v_since),
      'previous_count', (SELECT count(*) FROM trig WHERE triggered_at < v_since),
      'active',         (SELECT count(*) FROM active)),
    'reports', jsonb_build_object(
      'count',   (SELECT count(*) FROM rep WHERE created_at >= v_since),
      'last_at', (SELECT max(created_at) FROM rep),
      'recent',  (
        SELECT coalesce(jsonb_agg(jsonb_build_object(
                 'dev_eui',       r.dev_eui,
                 'device_name',   devs.name,
                 'location_name', devs.location_name,
                 'file',          r.file,
                 'created_at',    r.created_at)
               ORDER BY r.created_at DESC), '[]'::jsonb)
          FROM (SELECT * FROM rep ORDER BY created_at DESC LIMIT 4) r
          LEFT JOIN devs ON devs.dev_eui = r.dev_eui)),
    'uplinks', jsonb_build_object(
      'count',     (SELECT round(coalesce(sum(received), 0))::bigint FROM dev_act),
      'delivered', (SELECT round(delivered)::bigint FROM delivery),
      'expected',  (SELECT round(expected)::bigint FROM delivery)),
    'hourly', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('hour', h.hour, 'reporting', h.reporting)
             ORDER BY h.hour), '[]'::jsonb)
        FROM hourly h),
    'notes', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
               'id',            n.id,
               'dev_eui',       n.dev_eui,
               'device_name',   devs.name,
               'location_name', devs.location_name,
               'title',         n.title,
               'note',          n.note,
               'created_by',    n.created_by,
               'created_at',    n.created_at)
             ORDER BY n.created_at DESC, n.id DESC), '[]'::jsonb)
        FROM (
          SELECT * FROM cw_air_annotations
           WHERE dev_eui = ANY (p_dev_euis)
           ORDER BY created_at DESC, id DESC
           LIMIT 3
        ) n
        LEFT JOIN devs ON devs.dev_eui = n.dev_eui),
    'feed', jsonb_build_object(
      'counts', jsonb_build_object(
        'alert',  (SELECT count(*) FROM trig WHERE triggered_at >= v_since)
                  + (SELECT count(*) FROM resets),
        'device', (SELECT count(*) FROM dev_events),
        'report', (SELECT count(*) FROM rep WHERE created_at >= v_since),
        'data',   (SELECT count(*) FROM hourly WHERE hour = v_hour - interval '1 hour') + v_days),
      'items', (
        SELECT coalesce(jsonb_agg(item ORDER BY at DESC), '[]'::jsonb)
          FROM (
            SELECT fa.at, jsonb_strip_nulls(jsonb_build_object(
                     'kind',          fa.kind,
                     'at',            fa.at,
                     'dev_eui',       fa.dev_eui,
                     'device_name',   devs.name,
                     'location_name', devs.location_name,
                     'rule_name',     rt.name,
                     'triggered_at',  fa.triggered_at)) AS item
              FROM feed_alerts fa
              LEFT JOIN devs ON devs.dev_eui = fa.dev_eui
              LEFT JOIN cw_rule_templates rt ON rt.id = fa.template_id
            UNION ALL
            SELECT fd.occurred_at, jsonb_strip_nulls(jsonb_build_object(
                     'kind',          CASE WHEN fd.is_online THEN 'device_online' ELSE 'device_offline' END,
                     'at',            fd.occurred_at,
                     'dev_eui',       fd.dev_eui,
                     'device_name',   devs.name,
                     'location_name', devs.location_name,
                     'last_seen_at',  fd.last_seen_at))
              FROM feed_devices fd
              LEFT JOIN devs ON devs.dev_eui = fd.dev_eui
            UNION ALL
            SELECT fr.created_at, jsonb_strip_nulls(jsonb_build_object(
                     'kind',          'report',
                     'at',            fr.created_at,
                     'dev_eui',       fr.dev_eui,
                     'device_name',   devs.name,
                     'location_name', devs.location_name,
                     'file',          fr.file))
              FROM feed_reports fr
              LEFT JOIN devs ON devs.dev_eui = fr.dev_eui
            UNION ALL
            SELECT fdd.at, jsonb_strip_nulls(jsonb_build_object(
                     'kind',      fdd.kind,
                     'at',        fdd.at,
                     'reporting', fdd.reporting,
                     'total',     (SELECT total FROM totals),
                     'uplinks',   fdd.uplinks))
              FROM feed_data fdd
          ) f)),
    'attention', jsonb_build_object(
      'offline', (
        SELECT coalesce(jsonb_agg(jsonb_build_object('location_id', x.location_id, 'name', x.name, 'count', x.n)
               ORDER BY x.n DESC, x.name NULLS LAST), '[]'::jsonb)
          FROM (SELECT location_id, max(location_name) AS name, count(*) AS n
                  FROM devs WHERE NOT online GROUP BY location_id) x),
      'active_alerts', (
        SELECT coalesce(jsonb_agg(jsonb_build_object('location_id', x.location_id, 'name', x.name, 'count', x.n)
               ORDER BY x.n DESC, x.name NULLS LAST), '[]'::jsonb)
          FROM (SELECT devs.location_id, max(devs.location_name) AS name, count(*) AS n
                  FROM active JOIN devs ON devs.dev_eui = active.dev_eui
                 GROUP BY devs.location_id) x),
      'low_battery', (
        SELECT coalesce(jsonb_agg(jsonb_build_object('location_id', x.location_id, 'name', x.name, 'count', x.n)
               ORDER BY x.n DESC, x.name NULLS LAST), '[]'::jsonb)
          FROM (SELECT location_id, max(location_name) AS name, count(*) AS n
                  FROM devs WHERE low_battery GROUP BY location_id) x))
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

-- Grants: nobody but service_role (the API) may call these; pg_cron runs the
-- jobs as postgres, the owner.
REVOKE ALL ON FUNCTION public.cw_device_activity_recompute(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cw_device_activity_backfill(integer)                   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cw_overview_tick()                                     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cw_overview_prune()                                    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cw_overview(text[], integer, integer)                  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cw_overview(text[], integer, integer) TO service_role;

COMMIT;

-- =============================================================================
-- Step 2 — backfill 31 days of hourly activity (run after the COMMIT above)
-- =============================================================================
-- One day per inner call over the telemetry time indexes (~1 s per day on
-- prod, 2026-10-15). Writes only cw_device_activity_hourly. Idempotent.
SELECT public.cw_device_activity_backfill(31) AS backfilled_rows;

-- =============================================================================
-- Step 3 — first tick (seeds cw_device_status, logs no events) + schedules
-- =============================================================================
SELECT public.cw_overview_tick() AS first_tick;

-- Minute 2, 12, 22, ...: off the minute sync-cw-gateways-every-10-min uses,
-- and 2 minutes after each hour closes so the previous hour is complete.
-- cron.schedule with an existing name updates that job, so this is rerunnable.
SELECT cron.schedule('overview-tick-every-10-min', '2-59/10 * * * *', $$SELECT public.cw_overview_tick()$$);
SELECT cron.schedule('overview-prune-daily',       '17 3 * * *',      $$SELECT public.cw_overview_prune()$$);

-- =============================================================================
-- OPS — verification (read-only)
-- =============================================================================
-- SELECT jobname, schedule, command, active FROM cron.job WHERE jobname LIKE 'overview-%';
-- -- expect the two jobs, active
-- SELECT status, return_message, start_time, end_time - start_time AS took
--   FROM cron.job_run_details
--  WHERE jobid IN (SELECT jobid FROM cron.job WHERE jobname = 'overview-tick-every-10-min')
--  ORDER BY start_time DESC LIMIT 6;
-- -- expect succeeded every 10 min, well under a second each
-- SELECT count(*) AS rows, count(DISTINCT dev_eui) AS devices, min(hour), max(hour)
--   FROM public.cw_device_activity_hourly;
-- -- expect ~31 days, ~185 devices
-- SELECT is_online, count(*) FROM public.cw_device_status GROUP BY 1;
-- SELECT * FROM public.cw_device_status_events ORDER BY occurred_at DESC LIMIT 20;
-- -- Spot check: last complete hour, table vs telemetry (expect equal counts):
-- SELECT (SELECT sum(uplinks) FROM public.cw_device_activity_hourly
--          WHERE hour = date_trunc('hour', now()) - interval '1 hour'
--            AND dev_eui IN (SELECT dev_eui FROM public.cw_air_data GROUP BY 1)) AS table_air,
--        (SELECT count(*) FROM public.cw_air_data
--          WHERE created_at >= date_trunc('hour', now()) - interval '1 hour'
--            AND created_at <  date_trunc('hour', now())) AS telemetry_air;
-- -- One heavy caller (every device), 30 days: expect index scans only and
-- -- tens of milliseconds:
-- EXPLAIN (ANALYZE, BUFFERS)
-- SELECT public.cw_overview(ARRAY(SELECT dev_eui::text FROM public.cw_devices), 720, 20);
-- SELECT has_function_privilege('authenticated', 'public.cw_overview(text[], integer, integer)', 'EXECUTE') AS auth_exec,
--        has_function_privilege('service_role',  'public.cw_overview(text[], integer, integer)', 'EXECUTE') AS service_exec,
--        has_table_privilege('anon', 'public.cw_device_activity_hourly', 'SELECT')                    AS anon_select;
-- -- expect: f, t, f

-- =============================================================================
-- ROLLBACK (roll the API back first: /v1/overview would 500 without
-- cw_overview; nothing else reads these objects)
-- =============================================================================
-- SELECT cron.unschedule('overview-tick-every-10-min');
-- SELECT cron.unschedule('overview-prune-daily');
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.cw_overview(text[], integer, integer);
-- DROP FUNCTION IF EXISTS public.cw_overview_prune();
-- DROP FUNCTION IF EXISTS public.cw_overview_tick();
-- DROP FUNCTION IF EXISTS public.cw_device_activity_backfill(integer);
-- DROP FUNCTION IF EXISTS public.cw_device_activity_recompute(timestamptz, timestamptz);
-- DROP TABLE IF EXISTS public.cw_device_status_events;
-- DROP TABLE IF EXISTS public.cw_device_status;
-- DROP TABLE IF EXISTS public.cw_device_activity_hourly;
-- DROP INDEX IF EXISTS public.cw_rule_trigger_log_dev_eui_triggered_at_idx;
-- DROP INDEX IF EXISTS public.cw_relay_reports_reported_at_idx;
-- DROP INDEX IF EXISTS public.cw_traffic2_traffic_hour_idx;
-- DROP INDEX IF EXISTS public.cw_water_data_created_at_idx;
-- COMMIT;
