-- =============================================================================
-- UNDO_swap_sensors.sql — undo 01_swap_sensors.sql using the backups it took in the
-- "maintenance" schema (devswap_0171_780c_0110__*). Only needed if the swap has
-- to be reversed.
--
-- What it does
--   * moves back exactly the readings that were moved, by their backed-up keys
--     (notes follow through the cascade), and re-inserts the 8 removed transit
--     readings unchanged
--   * moves rule assignments, rule state, trigger log rows and report
--     assignments back by primary key, and re-inserts the ones 01 dropped as
--     duplicates (..._dropped); the fridge sensor's own alarms are not touched,
--     only its 43 fridge-era log rows go back
--   * restores the permission rows of 2CF7F1C061700171 and 2CF7F1C053000110
--     exactly as they were (same ids and levels)
--   * restores the retired sensor's name and the fridge sensor's group
--   * recounts the overview uplink counts of the three EUIs
--
-- Values that changed legitimately after the swap (the alert engine resetting
-- rules 17/19, new trigger log rows written for the fridge sensor) are moved back
-- as they are now, or — for rows created after the swap — left where they are.
-- Readings the sensors produced after the swap stay under their EUI.
--
-- Same safety model as 01: dry_run = TRUE rehearses and aborts on purpose.
-- The backup tables are left in place (01 refuses to run again while they exist);
-- drop them by hand when you no longer need them.
-- =============================================================================

-- Ends a transaction a previous run left aborted in the same session (DBeaver stops at the DRY RUN
-- error without rolling back); on a clean session it only prints "there is no transaction in progress".
ROLLBACK;

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';
SET LOCAL TimeZone = 'UTC';

CREATE TEMP TABLE _rb ON COMMIT DROP AS
SELECT TRUE AS dry_run;      -- TRUE = rehearse and roll back | FALSE = apply

-- -----------------------------------------------------------------------------
-- 1. PRE-FLIGHT
-- -----------------------------------------------------------------------------
DO $pre$
DECLARE
  l  record;
  n  bigint;
  k  bigint;
BEGIN
  IF to_regclass('maintenance.devswap_0171_780c_0110__log') IS NULL THEN
    RAISE EXCEPTION 'No backup found (maintenance.devswap_0171_780c_0110__log) — 01_swap_sensors.sql has not been applied, so there is nothing to undo. This file is only the undo; to apply the swap, set dry_run = FALSE in 01_swap_sensors.sql and run that.';
  END IF;
  SELECT * INTO STRICT l FROM maintenance.devswap_0171_780c_0110__log;

  PERFORM 1 FROM public.cw_devices WHERE dev_eui = l.retired_eui FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Retired device % is no longer in cw_devices (deleted after the swap?) — restore its row from the backup first',
      l.retired_eui;
  END IF;

  -- all moved readings must still be where 01 put them (none = already rolled back). Counted on
  -- the slots that are nobody's old slot: at a shared minute the moved sensor's slot is filled
  -- before (container reading) and after (fridge reading) a rollback, so it tells nothing.
  SELECT count(*) INTO k
    FROM maintenance.devswap_0171_780c_0110__cw_air_data_keys b
   WHERE NOT EXISTS (SELECT 1 FROM maintenance.devswap_0171_780c_0110__cw_air_data_keys k2
                      WHERE k2.from_eui = b.to_eui AND k2.created_at = b.created_at);
  SELECT count(*) INTO n
    FROM maintenance.devswap_0171_780c_0110__cw_air_data_keys b
   WHERE NOT EXISTS (SELECT 1 FROM maintenance.devswap_0171_780c_0110__cw_air_data_keys k2
                      WHERE k2.from_eui = b.to_eui AND k2.created_at = b.created_at)
     AND EXISTS (SELECT 1 FROM public.cw_air_data a WHERE a.dev_eui = b.to_eui AND a.created_at = b.created_at);
  IF n = 0 THEN
    RAISE EXCEPTION 'None of the moved readings is under its new EUI — already rolled back?';
  END IF;
  IF n <> k THEN
    RAISE EXCEPTION 'Only % of % moved readings are under their new EUI — something else changed them; roll back by hand', n, k;
  END IF;
  -- (an old slot may rightly be taken by another moved reading: the two old sensors share 1,182
  -- whole-minute timestamps, and the container reading from that minute now sits in the moved
  -- sensor's slot — it moves out first, below)
  SELECT count(*) INTO n
    FROM maintenance.devswap_0171_780c_0110__cw_air_data_keys b
   WHERE EXISTS (SELECT 1 FROM public.cw_air_data a WHERE a.dev_eui = b.from_eui AND a.created_at = b.created_at)
     AND NOT EXISTS (SELECT 1 FROM maintenance.devswap_0171_780c_0110__cw_air_data_keys k2
                      WHERE k2.to_eui = b.from_eui AND k2.created_at = b.created_at);
  IF n > 0 THEN
    RAISE EXCEPTION '% reading(s) already exist under their old EUI at backed-up timestamps', n;
  END IF;
  SELECT count(*) INTO n
    FROM maintenance.devswap_0171_780c_0110__cw_air_data_removed b
   WHERE EXISTS (SELECT 1 FROM public.cw_air_data a WHERE a.dev_eui = b.dev_eui AND a.created_at = b.created_at)
     AND NOT EXISTS (SELECT 1 FROM maintenance.devswap_0171_780c_0110__cw_air_data_keys k2
                      WHERE k2.to_eui = b.dev_eui AND k2.created_at = b.created_at);
  IF n > 0 THEN
    RAISE EXCEPTION '% removed transit reading(s) are already back', n;
  END IF;

  -- every row to move back by id must still exist (the dropped ones are re-inserted instead)
  SELECT (SELECT count(*) FROM maintenance.devswap_0171_780c_0110__cw_device_rule_assignments b
           WHERE NOT EXISTS (SELECT 1 FROM public.cw_device_rule_assignments x WHERE x.id = b.id)
             AND b.id NOT IN (SELECT id FROM maintenance.devswap_0171_780c_0110__dropped WHERE tbl = 'cw_device_rule_assignments'))
       + (SELECT count(*) FROM maintenance.devswap_0171_780c_0110__cw_rule_state b
           WHERE NOT EXISTS (SELECT 1 FROM public.cw_rule_state x WHERE x.id = b.id)
             AND b.id NOT IN (SELECT id FROM maintenance.devswap_0171_780c_0110__dropped WHERE tbl = 'cw_rule_state'))
       + (SELECT count(*) FROM maintenance.devswap_0171_780c_0110__cw_rule_trigger_log b
           WHERE NOT EXISTS (SELECT 1 FROM public.cw_rule_trigger_log x WHERE x.id = b.id))
       + (SELECT count(*) FROM maintenance.devswap_0171_780c_0110__cw_device_report_assignments b
           WHERE NOT EXISTS (SELECT 1 FROM public.cw_device_report_assignments x WHERE x.id = b.id)
             AND b.id NOT IN (SELECT id FROM maintenance.devswap_0171_780c_0110__dropped WHERE tbl = 'cw_device_report_assignments'))
    INTO n;
  IF n > 0 THEN
    RAISE EXCEPTION '% rule/report row(s) from the backup no longer exist (edited in the UI after the swap?) — roll back by hand', n;
  END IF;
END
$pre$;

-- -----------------------------------------------------------------------------
-- 2. READINGS — the container part out of moved_eui first, so the fridge part can come back
-- -----------------------------------------------------------------------------
UPDATE public.cw_air_data a
   SET dev_eui = k.from_eui
  FROM maintenance.devswap_0171_780c_0110__cw_air_data_keys k, maintenance.devswap_0171_780c_0110__log l
 WHERE k.from_eui = l.retired_eui
   AND a.dev_eui = k.to_eui AND a.created_at = k.created_at;

UPDATE public.cw_air_data a
   SET dev_eui = k.from_eui
  FROM maintenance.devswap_0171_780c_0110__cw_air_data_keys k, maintenance.devswap_0171_780c_0110__log l
 WHERE k.from_eui = l.moved_eui
   AND a.dev_eui = k.to_eui AND a.created_at = k.created_at;

INSERT INTO public.cw_air_data SELECT * FROM maintenance.devswap_0171_780c_0110__cw_air_data_removed;

-- -----------------------------------------------------------------------------
-- 3. ALARMS AND REPORTS — by primary key, values as they are now
-- -----------------------------------------------------------------------------
UPDATE public.cw_device_rule_assignments x SET dev_eui = b.dev_eui
  FROM maintenance.devswap_0171_780c_0110__cw_device_rule_assignments b WHERE x.id = b.id;
UPDATE public.cw_rule_state x SET dev_eui = b.dev_eui
  FROM maintenance.devswap_0171_780c_0110__cw_rule_state b WHERE x.id = b.id;
UPDATE public.cw_rule_trigger_log x SET dev_eui = b.dev_eui
  FROM maintenance.devswap_0171_780c_0110__cw_rule_trigger_log b WHERE x.id = b.id;
UPDATE public.cw_device_report_assignments x SET dev_eui = b.dev_eui
  FROM maintenance.devswap_0171_780c_0110__cw_device_report_assignments b WHERE x.id = b.id;

-- rows 01 dropped because the receiving sensor already had the template (none in the surveyed state)
INSERT INTO public.cw_device_rule_assignments
SELECT b.* FROM maintenance.devswap_0171_780c_0110__cw_device_rule_assignments b
  JOIN maintenance.devswap_0171_780c_0110__dropped d ON d.tbl = 'cw_device_rule_assignments' AND d.id = b.id;
INSERT INTO public.cw_rule_state
SELECT b.* FROM maintenance.devswap_0171_780c_0110__cw_rule_state b
  JOIN maintenance.devswap_0171_780c_0110__dropped d ON d.tbl = 'cw_rule_state' AND d.id = b.id;
INSERT INTO public.cw_device_report_assignments
SELECT b.* FROM maintenance.devswap_0171_780c_0110__cw_device_report_assignments b
  JOIN maintenance.devswap_0171_780c_0110__dropped d ON d.tbl = 'cw_device_report_assignments' AND d.id = b.id;

-- -----------------------------------------------------------------------------
-- 4. USER PERMISSIONS — every backed-up row back exactly (rows added for other users since are kept)
-- -----------------------------------------------------------------------------
DELETE FROM public.cw_device_owners x
 USING maintenance.devswap_0171_780c_0110__cw_device_owners b
 WHERE x.id = b.id;

INSERT INTO public.cw_device_owners (user_id, dev_eui, owner_id, id, permission_level, is_legacy)
SELECT user_id, dev_eui, owner_id, id, permission_level, is_legacy
  FROM maintenance.devswap_0171_780c_0110__cw_device_owners;

-- -----------------------------------------------------------------------------
-- 5. DEVICE ROWS
-- -----------------------------------------------------------------------------
UPDATE public.cw_devices d
   SET name = b.name, "group" = b."group"
  FROM maintenance.devswap_0171_780c_0110__cw_devices b, maintenance.devswap_0171_780c_0110__log l
 WHERE d.dev_eui = b.dev_eui
   AND b.dev_eui IN (l.retired_eui, l.fridge_eui);

-- -----------------------------------------------------------------------------
-- 6. OVERVIEW UPLINK COUNTS — same recount as 01
-- -----------------------------------------------------------------------------
DO $act$
DECLARE
  l       record;
  v_from  timestamptz;
BEGIN
  SELECT * INTO STRICT l FROM maintenance.devswap_0171_780c_0110__log;
  SELECT COALESCE(min(hour), date_trunc('hour', now()) - interval '35 days') INTO v_from
    FROM public.cw_device_activity_hourly;

  DELETE FROM public.cw_device_activity_hourly WHERE dev_eui IN (l.moved_eui, l.retired_eui, l.fridge_eui);

  INSERT INTO public.cw_device_activity_hourly (dev_eui, hour, uplinks)
  SELECT c.dev_eui, c.hour, sum(c.n)::integer
    FROM (
      SELECT dev_eui::text AS dev_eui, date_trunc('hour', created_at) AS hour, count(*) AS n
        FROM public.cw_air_data
       WHERE dev_eui IN (l.moved_eui, l.retired_eui, l.fridge_eui) AND created_at >= v_from
       GROUP BY 1, 2
      UNION ALL
      SELECT dev_eui::text, date_trunc('hour', created_at), count(*)
        FROM public.cw_soil_data
       WHERE dev_eui IN (l.moved_eui, l.retired_eui, l.fridge_eui) AND created_at >= v_from
       GROUP BY 1, 2
      UNION ALL
      SELECT dev_eui::text, date_trunc('hour', created_at), count(*)
        FROM public.cw_water_data
       WHERE dev_eui IN (l.moved_eui, l.retired_eui, l.fridge_eui) AND created_at >= v_from
       GROUP BY 1, 2
      UNION ALL
      SELECT dev_eui, date_trunc('hour', reported_at), count(*)
        FROM public.cw_relay_reports
       WHERE dev_eui IN (l.moved_eui, l.retired_eui, l.fridge_eui) AND reported_at >= v_from
       GROUP BY 1, 2
      UNION ALL
      SELECT dev_eui::text, traffic_hour, count(*)
        FROM public.cw_traffic2
       WHERE dev_eui IN (l.moved_eui, l.retired_eui, l.fridge_eui) AND traffic_hour >= v_from
       GROUP BY 1, 2
    ) c
   GROUP BY c.dev_eui, c.hour;
END
$act$;

-- -----------------------------------------------------------------------------
-- 7. VERIFY
-- -----------------------------------------------------------------------------
DO $chk$
DECLARE
  l   record;
  c   record;
  n   bigint;
BEGIN
  SELECT * INTO STRICT l FROM maintenance.devswap_0171_780c_0110__log;

  -- (the new slot may rightly be taken again by the reading that came back from it: shared minutes)
  SELECT count(*) INTO n
    FROM maintenance.devswap_0171_780c_0110__cw_air_data_keys k
   WHERE NOT EXISTS (SELECT 1 FROM public.cw_air_data a WHERE a.dev_eui = k.from_eui AND a.created_at = k.created_at)
      OR (EXISTS     (SELECT 1 FROM public.cw_air_data a WHERE a.dev_eui = k.to_eui AND a.created_at = k.created_at)
          AND NOT EXISTS (SELECT 1 FROM maintenance.devswap_0171_780c_0110__cw_air_data_keys k2
                           WHERE k2.from_eui = k.to_eui AND k2.created_at = k.created_at));
  IF n <> 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: % reading(s) are not back under their original EUI', n;
  END IF;
  FOR c IN SELECT * FROM maintenance.devswap_0171_780c_0110__cw_air_data_checksums LOOP
    IF (SELECT md5(string_agg(row(a.created_at, a.temperature_c, a.humidity, a.co2, a.pressure, a.co, a.battery_level,
                                  a.is_simulated, a.rainfall, a.wind_speed, a.wind_direction, a.lux, a.uv_index)::text,
                              '|' ORDER BY a.created_at))
          FROM maintenance.devswap_0171_780c_0110__cw_air_data_keys k
          JOIN public.cw_air_data a ON a.dev_eui = k.from_eui AND a.created_at = k.created_at
         WHERE k.from_eui = c.from_eui) IS DISTINCT FROM c.md5 THEN
      RAISE EXCEPTION 'VERIFY FAILED: the readings returned to % do not match their checksum', c.from_eui;
    END IF;
  END LOOP;
  SELECT count(*) INTO n
    FROM maintenance.devswap_0171_780c_0110__cw_air_data_removed b
   WHERE NOT EXISTS (SELECT 1 FROM public.cw_air_data a WHERE a.dev_eui = b.dev_eui AND a.created_at = b.created_at);
  IF n <> 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: % transit reading(s) were not restored', n;
  END IF;

  SELECT count(*) INTO n
    FROM maintenance.devswap_0171_780c_0110__cw_air_annotations b
   WHERE NOT EXISTS (SELECT 1 FROM public.cw_air_annotations x WHERE x.id = b.id AND x.dev_eui = b.dev_eui);
  IF n <> 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: % note(s) are not back on their original EUI', n;
  END IF;

  SELECT (SELECT count(*) FROM maintenance.devswap_0171_780c_0110__cw_device_rule_assignments b
           WHERE NOT EXISTS (SELECT 1 FROM public.cw_device_rule_assignments x WHERE x.id = b.id AND x.dev_eui = b.dev_eui))
       + (SELECT count(*) FROM maintenance.devswap_0171_780c_0110__cw_rule_state b
           WHERE NOT EXISTS (SELECT 1 FROM public.cw_rule_state x WHERE x.id = b.id AND x.dev_eui = b.dev_eui))
       + (SELECT count(*) FROM maintenance.devswap_0171_780c_0110__cw_rule_trigger_log b
           WHERE NOT EXISTS (SELECT 1 FROM public.cw_rule_trigger_log x WHERE x.id = b.id AND x.dev_eui = b.dev_eui))
       + (SELECT count(*) FROM maintenance.devswap_0171_780c_0110__cw_device_report_assignments b
           WHERE NOT EXISTS (SELECT 1 FROM public.cw_device_report_assignments x WHERE x.id = b.id AND x.dev_eui = b.dev_eui))
       + (SELECT count(*) FROM maintenance.devswap_0171_780c_0110__cw_device_owners b
           WHERE NOT EXISTS (SELECT 1 FROM public.cw_device_owners x
                              WHERE x.id = b.id AND x.dev_eui = b.dev_eui AND x.user_id = b.user_id
                                AND x.permission_level = b.permission_level))
       + (SELECT count(*) FROM maintenance.devswap_0171_780c_0110__cw_devices b
           WHERE NOT EXISTS (SELECT 1 FROM public.cw_devices x
                              WHERE x.dev_eui = b.dev_eui AND x.name = b.name AND x."group" IS NOT DISTINCT FROM b."group"))
    INTO n;
  IF n <> 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: % rule/report/permission/device row(s) are not back as backed up', n;
  END IF;

  RAISE NOTICE 'All rollback checks passed.';
  IF (SELECT dry_run FROM _rb) THEN
    RAISE EXCEPTION 'DRY RUN OK — the rollback would succeed; NOTHING was changed (rolled back on purpose). >>> set dry_run = FALSE to apply.';
  END IF;
END
$chk$;

COMMIT;

SELECT d.dev_eui, d.name,
       (SELECT count(*) FROM public.cw_air_data a WHERE a.dev_eui = d.dev_eui)                      AS readings,
       (SELECT array_agg(template_id ORDER BY template_id) FROM public.cw_device_rule_assignments r
         WHERE r.dev_eui = d.dev_eui)                                                               AS rule_templates,
       (SELECT array_agg(template_id ORDER BY template_id) FROM public.cw_device_report_assignments r
         WHERE r.dev_eui = d.dev_eui)                                                               AS report_templates,
       (SELECT count(*) FROM public.cw_device_owners o WHERE o.dev_eui = d.dev_eui)                 AS permission_rows
  FROM public.cw_devices d
 WHERE d.dev_eui IN ('343634315F33780C', '2CF7F1C061700171', '2CF7F1C053000110')
 ORDER BY d.location_id, d.dev_eui;
