-- =============================================================================
-- 035_overview_links.sql
-- =============================================================================
-- Links on the overview page (033): cw_overview now also returns
--   * location_id on every item that names a device (feed alerts, device
--     events and reports; recent reports; notes), so the page can link to the
--     device (/locations/<location_id>/devices/<dev_eui>);
--   * alerts.top_devices: the five devices with the most alerts in range
--     (dev_eui, device_name, location_id, location_name, count), for the
--     breakdown's Alerts view, which now links each entry to its device.
-- Nothing else changes: same signature, same reads (no new table access), same
-- grants. CREATE OR REPLACE keeps EXECUTE on service_role; restated below.
--
-- HOW TO RUN (SQL editor, as postgres): the whole file, any time. Run it
-- before deploying the overview API release (the API reads the new fields;
-- without them the page shows the same data with fewer links). Rerunnable.
-- Rollback: rerun the cw_overview definition from 033_overview.sql.
-- =============================================================================

BEGIN;

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
      'active',         (SELECT count(*) FROM active),
      'top_devices',    (
        SELECT coalesce(jsonb_agg(jsonb_build_object(
                 'dev_eui',       x.dev_eui,
                 'device_name',   devs.name,
                 'location_id',   devs.location_id,
                 'location_name', devs.location_name,
                 'count',         x.n)
               ORDER BY x.n DESC, x.dev_eui), '[]'::jsonb)
          FROM (SELECT dev_eui, count(*) AS n
                  FROM trig
                 WHERE triggered_at >= v_since
                 GROUP BY dev_eui
                 ORDER BY n DESC, dev_eui
                 LIMIT 5) x
          LEFT JOIN devs ON devs.dev_eui = x.dev_eui)),
    'reports', jsonb_build_object(
      'count',   (SELECT count(*) FROM rep WHERE created_at >= v_since),
      'last_at', (SELECT max(created_at) FROM rep),
      'recent',  (
        SELECT coalesce(jsonb_agg(jsonb_build_object(
                 'dev_eui',       r.dev_eui,
                 'device_name',   devs.name,
                 'location_id',   devs.location_id,
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
               'location_id',   devs.location_id,
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
                     'location_id',   devs.location_id,
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
                     'location_id',   devs.location_id,
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
                     'location_id',   devs.location_id,
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

REVOKE ALL ON FUNCTION public.cw_overview(text[], integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cw_overview(text[], integer, integer) TO service_role;

COMMIT;

-- =============================================================================
-- OPS — verification (read-only)
-- =============================================================================
-- SELECT pg_get_functiondef('public.cw_overview(text[], integer, integer)'::regprocedure) LIKE '%top_devices%' AS has_top_devices;
-- -- expect: t
-- SELECT jsonb_pretty(public.cw_overview(ARRAY(SELECT dev_eui::text FROM public.cw_devices), 168, 3) -> 'alerts');
-- -- expect: count / previous_count / active plus top_devices with location_id
