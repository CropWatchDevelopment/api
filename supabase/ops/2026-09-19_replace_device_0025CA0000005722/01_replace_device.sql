-- =============================================================================
-- 01_replace_device.sql
--
-- Hardware replacement: the sensor 0025CA0000005722 ("トンネルフリーザー1",
-- location 155 凍結工程) is broken and decommissioned. Its replacement is
-- 3436343159337A10. After this script the NEW EUI is "トンネルフリーザー1" and
-- owns everything the old one had: history, user permissions, rule, rule state
-- and trigger log, and the weekly report assignment.
--
-- WHY A SCRIPT AND NOT THE API's replaceDevice: that endpoint renames
-- cw_devices.dev_eui and relies on ON UPDATE CASCADE. Three tables that matter
-- have NO foreign key to cw_devices, so nothing cascades to them:
--     cw_air_data (12,227 readings), cw_rule_state, cw_rule_monthly_usage
-- and two FKs have no ON UPDATE CASCADE (cw_report_regeneration_queue,
-- cw_watermeter_uplinks) and would block a rename. It would also hit the primary
-- key here, because the replacement already has a cw_devices row. This script
-- therefore merges the old device INTO the existing row of the new one and
-- repoints every table explicitly.
--
-- STATE WHEN THIS WAS WRITTEN (read-only survey, 2026-09-19 00:30 JST):
--     old EUI : cw_devices 1 | cw_air_data 12,227 (2026-06-08 .. 2026-09-10 22:50Z)
--               cw_device_owners 5 | cw_device_rule_assignments 1 (template 9)
--               cw_rule_state 1 (is_triggered = TRUE) | cw_rule_trigger_log 73
--               cw_device_report_assignments 1 (template 15) | everything else 0
--     new EUI : ALREADY REGISTERED AND LIVE — cw_devices row "JA Pipe Device"
--               (type 2, no location, no group, no owner rows), 67 readings since
--               2026-09-18 03:48Z and one more every ~10 minutes; no rules,
--               reports, rule state or log; 0 rows everywhere else.
--     Those 67 readings are real freezer data (about 14 C until 13:59 JST, then
--     -18 .. -33 C from 14:20 while the tunnel ran, warming since 18:05) and are
--     KEPT: they become the newest part of トンネルフリーザー1's history. The two
--     histories do not overlap (old ends 09-10, new starts 09-18).
--     A text search of all other public tables found no other reference.
--
-- HOW TO RUN
--   1. Leave dry_run = TRUE and run the whole file. It performs the complete
--      migration, verifies it, then ABORTS ON PURPOSE with
--      "DRY RUN OK ..." and a summary. Nothing is changed.
--   2. Set dry_run = FALSE and run it again to apply. The last statement prints
--      the resulting state.
--   psql:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 01_replace_device.sql
--   Any failed check raises an exception, which rolls back EVERYTHING.
--
-- *** WHAT HAPPENS THE MOMENT THIS COMMITS — READ THIS ***
--   The new sensor is live, so from its next uplink (within ~10 minutes) the
--   alert engine evaluates rule 9 against it and the 5 users see the device.
--
--   Rule template 9 (トンネルフリーザー温度異常: trigger >= -20 C, reset <= -25 C,
--   2 LoRaWAN actions + e-mail) cycles daily with the tunnel (73 log entries)
--   and is currently TRIGGERED: the last action it dispatched was the trigger on
--   2026-09-10 08:17Z, and the old sensor died before the next reset. The state
--   row is moved UNCHANGED on purpose. While is_triggered is true the alert
--   engine never re-fires, it only waits for the reset value — so whatever the
--   new sensor reads when this commits (it is about +11 C at night, tunnel off)
--   nothing is dispatched, and the engine's state stays consistent with the
--   last action the customer's relays actually received. The RESET actions go
--   out when the sensor next reads <= -25 C (next tunnel start), and the normal
--   daily cycle resumes from there. Clearing the state instead would fire the
--   e-mail and both LoRaWAN actions on the very next warm reading.
--
-- NOT DONE HERE (cannot be done safely in SQL): 12 weekly report PDFs live in
-- the "Reports" storage bucket under "0025CA0000005722/". The API lists a
-- device's report history by that folder name, so they disappear from the UI
-- until they are copied to "3436343159337A10/" — see 03_copy_report_pdfs.py.
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';          -- fail fast instead of queueing behind another writer
SET LOCAL statement_timeout = '10min';

-- -----------------------------------------------------------------------------
-- 0. PARAMETERS — the only lines you should need to touch
-- -----------------------------------------------------------------------------
CREATE TEMP TABLE _swap ON COMMIT DROP AS
SELECT
  '0025CA0000005722'::varchar  AS old_eui,
  '3436343159337A10'::varchar  AS new_eui,
  'トンネルフリーザー1'::text      AS expected_name,       -- guard: the old device must currently have this name
  155::bigint                   AS expected_location,   -- guard: ... and sit in this location
  TRUE                          AS dry_run,             -- TRUE = rehearse and roll back | FALSE = apply
  'rename'::text                AS old_device_action;   -- 'rename' = keep the old row as a labelled tombstone
                                                        --            (invisible to customers: visibility comes
                                                        --            from cw_device_owners, which all move)
                                                        -- 'delete' = remove the old cw_devices row (it is
                                                        --            saved in the backup table either way)

CREATE TEMP TABLE _swap_counts (
  tbl         text PRIMARY KEY,
  kind        text   NOT NULL,   -- air | owners | strict | generic
  old_before  bigint NOT NULL,
  new_before  bigint NOT NULL,
  old_after   bigint,
  new_after   bigint
) ON COMMIT DROP;

-- -----------------------------------------------------------------------------
-- 1. PRE-FLIGHT — refuse to run against anything unexpected
-- -----------------------------------------------------------------------------
DO $pre$
DECLARE
  p      record;
  d_old  public.cw_devices%ROWTYPE;
  d_new  public.cw_devices%ROWTYPE;
  t      record;
  c_old  bigint;
  c_new  bigint;
  n      bigint;
BEGIN
  SELECT * INTO STRICT p FROM _swap;

  IF p.old_eui !~ '^[0-9A-F]{16}$' OR p.new_eui !~ '^[0-9A-F]{16}$' THEN
    RAISE EXCEPTION 'EUIs must be 16 upper-case hex characters (got "%" and "%")', p.old_eui, p.new_eui;
  END IF;
  IF p.old_eui = p.new_eui THEN
    RAISE EXCEPTION 'old_eui and new_eui are the same';
  END IF;
  IF p.old_device_action NOT IN ('rename', 'delete') THEN
    RAISE EXCEPTION 'old_device_action must be ''rename'' or ''delete'' (got "%")', p.old_device_action;
  END IF;

  -- Lock the old device row for the whole transaction.
  SELECT * INTO d_old FROM public.cw_devices WHERE dev_eui = p.old_eui FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Old device % is not in cw_devices — already migrated, or wrong database?', p.old_eui;
  END IF;
  IF d_old.name IS DISTINCT FROM p.expected_name THEN
    RAISE EXCEPTION 'Old device is named "%", expected "%" — already migrated (tombstone), or wrong device?',
      d_old.name, p.expected_name;
  END IF;
  IF d_old.location_id IS DISTINCT FROM p.expected_location THEN
    RAISE EXCEPTION 'Old device is in location %, expected %', d_old.location_id, p.expected_location;
  END IF;

  -- The new device row may or may not exist yet; if it does it must be the same device type,
  -- because rule and report templates are bound to a device type.
  SELECT * INTO d_new FROM public.cw_devices WHERE dev_eui = p.new_eui FOR UPDATE;
  IF FOUND AND d_new.type IS DISTINCT FROM d_old.type THEN
    RAISE EXCEPTION 'New device % already exists with type %, old device has type %', p.new_eui, d_new.type, d_old.type;
  END IF;

  FOR t IN
    SELECT * FROM (VALUES
      ('cw_air_data',                  'air'),
      ('cw_device_owners',             'owners'),
      -- "strict": the NEW EUI must not already carry any of this — a human has to decide a merge
      ('cw_air_alerts',                'strict'),
      ('cw_air_annotations',           'strict'),
      ('cw_device_rule_assignments',   'strict'),
      ('cw_device_report_assignments', 'strict'),
      ('cw_rule_state',                'strict'),
      ('cw_rule_trigger_log',          'strict'),
      ('cw_rule_monthly_usage',        'strict'),
      -- "generic": all empty for this device today; moved if present, never merged
      ('cw_soil_data',                 'generic'),
      ('cw_water_data',                'generic'),
      ('cw_power_data',                'generic'),
      ('cw_relay_data',                'generic'),
      ('cw_traffic2',                  'generic'),
      ('cw_watermeter_uplinks',        'generic'),
      ('cw_device_gateway',            'generic'),
      ('device_licenses',              'generic'),
      ('cw_report_regeneration_queue', 'generic'),
      ('ip_log',                       'generic')
    ) AS v(tbl, kind)
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE dev_eui = $1', t.tbl) INTO c_old USING p.old_eui;
    EXECUTE format('SELECT count(*) FROM public.%I WHERE dev_eui = $1', t.tbl) INTO c_new USING p.new_eui;
    INSERT INTO _swap_counts (tbl, kind, old_before, new_before) VALUES (t.tbl, t.kind, c_old, c_new);

    IF t.kind = 'strict' AND c_new > 0 THEN
      RAISE EXCEPTION 'New device % already has % row(s) in % — stop and decide how to merge by hand',
        p.new_eui, c_new, t.tbl;
    END IF;
    IF t.kind = 'generic' AND c_old > 0 AND c_new > 0 THEN
      RAISE EXCEPTION 'Both devices have rows in % (old %, new %) — stop and decide how to merge by hand',
        t.tbl, c_old, c_new;
    END IF;
  END LOOP;

  IF (SELECT old_before FROM _swap_counts WHERE tbl = 'cw_air_data') = 0 THEN
    RAISE EXCEPTION 'Old device % has no cw_air_data rows — already migrated?', p.old_eui;
  END IF;

  -- cw_air_data's primary key is (dev_eui, created_at): the two histories must not share a minute.
  SELECT count(*) INTO n
    FROM public.cw_air_data o
   WHERE o.dev_eui = p.old_eui
     AND EXISTS (SELECT 1 FROM public.cw_air_data x WHERE x.dev_eui = p.new_eui AND x.created_at = o.created_at);
  IF n > 0 THEN
    RAISE EXCEPTION '% cw_air_data timestamp(s) exist for BOTH devices — the histories overlap', n;
  END IF;
END
$pre$;

-- -----------------------------------------------------------------------------
-- 2. BACKUP — private schema (public is exposed through PostgREST; this is not)
--    CREATE TABLE without IF NOT EXISTS on purpose: a second real run must fail
--    here rather than overwrite the backup of the first.
-- -----------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS maintenance;
REVOKE ALL ON SCHEMA maintenance FROM PUBLIC;
COMMENT ON SCHEMA maintenance IS 'Operator backups taken by one-off data migrations. Not exposed through the API.';

CREATE TABLE maintenance.devswap_5722_to_7a10__cw_devices AS
  SELECT d.* FROM public.cw_devices d
   WHERE d.dev_eui IN (SELECT old_eui FROM _swap UNION ALL SELECT new_eui FROM _swap);

CREATE TABLE maintenance.devswap_5722_to_7a10__cw_device_owners AS
  SELECT x.* FROM public.cw_device_owners x
   WHERE x.dev_eui IN (SELECT old_eui FROM _swap UNION ALL SELECT new_eui FROM _swap);

CREATE TABLE maintenance.devswap_5722_to_7a10__cw_device_rule_assignments AS
  SELECT x.* FROM public.cw_device_rule_assignments x WHERE x.dev_eui = (SELECT old_eui FROM _swap);

CREATE TABLE maintenance.devswap_5722_to_7a10__cw_device_report_assignments AS
  SELECT x.* FROM public.cw_device_report_assignments x WHERE x.dev_eui = (SELECT old_eui FROM _swap);

CREATE TABLE maintenance.devswap_5722_to_7a10__cw_rule_state AS
  SELECT x.* FROM public.cw_rule_state x WHERE x.dev_eui = (SELECT old_eui FROM _swap);

CREATE TABLE maintenance.devswap_5722_to_7a10__cw_rule_trigger_log AS
  SELECT x.* FROM public.cw_rule_trigger_log x WHERE x.dev_eui = (SELECT old_eui FROM _swap);

CREATE TABLE maintenance.devswap_5722_to_7a10__cw_rule_monthly_usage AS
  SELECT x.* FROM public.cw_rule_monthly_usage x WHERE x.dev_eui = (SELECT old_eui FROM _swap);

CREATE TABLE maintenance.devswap_5722_to_7a10__cw_air_alerts AS
  SELECT x.* FROM public.cw_air_alerts x WHERE x.dev_eui = (SELECT old_eui FROM _swap);

CREATE TABLE maintenance.devswap_5722_to_7a10__cw_air_annotations AS
  SELECT x.* FROM public.cw_air_annotations x WHERE x.dev_eui = (SELECT old_eui FROM _swap);

-- The readings themselves are only re-keyed, never altered, so the key list is a complete
-- record of what moved (the rollback uses it to move exactly these rows back).
CREATE TABLE maintenance.devswap_5722_to_7a10__cw_air_data_keys AS
  SELECT a.dev_eui, a.created_at FROM public.cw_air_data a WHERE a.dev_eui = (SELECT old_eui FROM _swap);

CREATE TABLE maintenance.devswap_5722_to_7a10__log AS
  SELECT now()                 AS ran_at,
         current_user::text    AS ran_by,
         s.old_eui, s.new_eui, s.old_device_action,
         NOT EXISTS (SELECT 1 FROM public.cw_devices d WHERE d.dev_eui = s.new_eui) AS created_new_device_row,
         (SELECT max(created_at) FROM public.cw_air_data a WHERE a.dev_eui = s.old_eui) AS old_history_last_reading
    FROM _swap s;

-- -----------------------------------------------------------------------------
-- 3. THE NEW DEVICE ROW
--    Present (today's case: "JA Pipe Device") -> the UPDATE below. The name is forced to the
--                old device's; location 155 and group JA are filled in because they are empty
--                on the new row; user_id and upload_interval are already the same. Everything
--                that describes the new HARDWARE is left alone: its own sensor serials
--                (186140283 / 318154057), error_status and its live last_data_updated_at.
--    Missing  -> the INSERT below (a no-op today) clones the old row's configuration without
--                the hardware facts; kept so the script is also right for a sensor that has
--                not been registered yet.
-- -----------------------------------------------------------------------------
INSERT INTO public.cw_devices (
  dev_eui, name, type, upload_interval, lat, long, installed_at, battery_changed_at, user_id,
  warranty_start_date, sensor1_serial, location_id, report_endpoint, battery_level,
  last_data_updated_at, tti_name, primary_data, secondary_data, sensor_serial, "group",
  sensor2_serial, error_status)
SELECT
  s.new_eui, o.name, o.type, o.upload_interval, o.lat, o.long, NULL, NULL, o.user_id,
  NULL, NULL, o.location_id, o.report_endpoint, NULL,
  o.last_data_updated_at, o.tti_name, o.primary_data, o.secondary_data, NULL, o."group",
  NULL, NULL
FROM _swap s
JOIN public.cw_devices o ON o.dev_eui = s.old_eui
WHERE NOT EXISTS (SELECT 1 FROM public.cw_devices n WHERE n.dev_eui = s.new_eui);

UPDATE public.cw_devices n
   SET name                 = o.name,
       location_id          = COALESCE(n.location_id, o.location_id),
       user_id              = COALESCE(n.user_id, o.user_id),
       "group"              = COALESCE(n."group", o."group"),
       upload_interval      = COALESCE(n.upload_interval, o.upload_interval),
       last_data_updated_at = GREATEST(n.last_data_updated_at, o.last_data_updated_at)
  FROM _swap s
  JOIN public.cw_devices o ON o.dev_eui = s.old_eui
 WHERE n.dev_eui = s.new_eui;

-- -----------------------------------------------------------------------------
-- 4. HISTORY
--    cw_air_alerts and cw_air_annotations follow their air row automatically (composite FK
--    to cw_air_data with ON UPDATE CASCADE). The two explicit statements only catch rows that
--    are not tied to an air row (NULL air_created_at), which a cascade cannot reach.
-- -----------------------------------------------------------------------------
UPDATE public.cw_air_data
   SET dev_eui = (SELECT new_eui FROM _swap)
 WHERE dev_eui = (SELECT old_eui FROM _swap);

UPDATE public.cw_air_alerts
   SET dev_eui = (SELECT new_eui FROM _swap)
 WHERE dev_eui = (SELECT old_eui FROM _swap);

UPDATE public.cw_air_annotations
   SET dev_eui = (SELECT new_eui FROM _swap)
 WHERE dev_eui = (SELECT old_eui FROM _swap);

-- -----------------------------------------------------------------------------
-- 5. USER PERMISSIONS  (UNIQUE (dev_eui, user_id))
--    If the new device already has a row for a user (the app adds DISABLED rows for every
--    location user when a device is created through the UI), the permission level that
--    user had on the OLD device wins — that is what the customer has been working with.
-- -----------------------------------------------------------------------------
UPDATE public.cw_device_owners n
   SET permission_level = o.permission_level
  FROM public.cw_device_owners o, _swap s
 WHERE n.dev_eui = s.new_eui
   AND o.dev_eui = s.old_eui
   AND n.user_id = o.user_id;

DELETE FROM public.cw_device_owners o
 USING _swap s
 WHERE o.dev_eui = s.old_eui
   AND EXISTS (SELECT 1 FROM public.cw_device_owners n WHERE n.dev_eui = s.new_eui AND n.user_id = o.user_id);

UPDATE public.cw_device_owners
   SET dev_eui = (SELECT new_eui FROM _swap)
 WHERE dev_eui = (SELECT old_eui FROM _swap);

-- -----------------------------------------------------------------------------
-- 6. RULES, REPORTS AND EVERYTHING ELSE
--    Templates are shared and are NOT touched (rule template 9 also serves
--    トンネルフリーザー2); only this device's assignment/state/log rows move.
--    cw_rule_state keeps is_triggered exactly as it is — see the header.
-- -----------------------------------------------------------------------------
DO $mv$
DECLARE
  p  record;
  t  record;
BEGIN
  SELECT * INTO STRICT p FROM _swap;
  FOR t IN SELECT tbl FROM _swap_counts WHERE kind IN ('strict', 'generic')
                                           AND tbl NOT IN ('cw_air_alerts', 'cw_air_annotations')
           ORDER BY tbl
  LOOP
    EXECUTE format('UPDATE public.%I SET dev_eui = $1 WHERE dev_eui = $2', t.tbl) USING p.new_eui, p.old_eui;
  END LOOP;
END
$mv$;

-- -----------------------------------------------------------------------------
-- 7. THE OLD DEVICE ROW — nothing references it any more
-- -----------------------------------------------------------------------------
UPDATE public.cw_devices d
   SET name = d.name || '（交換済 → ' || s.new_eui || '）'
  FROM _swap s
 WHERE d.dev_eui = s.old_eui
   AND s.old_device_action = 'rename';

DELETE FROM public.cw_devices d
 USING _swap s
 WHERE d.dev_eui = s.old_eui
   AND s.old_device_action = 'delete';

-- -----------------------------------------------------------------------------
-- 8. VERIFY — any mismatch raises and rolls the whole transaction back
-- -----------------------------------------------------------------------------
DO $chk$
DECLARE
  p        record;
  t        record;
  c_old    bigint;
  c_new    bigint;
  expected bigint;
  n        bigint;
  summary  text := '';
BEGIN
  SELECT * INTO STRICT p FROM _swap;

  FOR t IN SELECT * FROM _swap_counts ORDER BY tbl LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE dev_eui = $1', t.tbl) INTO c_old USING p.old_eui;
    EXECUTE format('SELECT count(*) FROM public.%I WHERE dev_eui = $1', t.tbl) INTO c_new USING p.new_eui;
    UPDATE _swap_counts SET old_after = c_old, new_after = c_new WHERE tbl = t.tbl;

    IF c_old <> 0 THEN
      RAISE EXCEPTION 'VERIFY FAILED: % still has % row(s) for the old device', t.tbl, c_old;
    END IF;

    IF t.kind = 'owners' THEN
      -- one row per distinct user across both devices
      SELECT count(DISTINCT user_id) INTO expected FROM maintenance.devswap_5722_to_7a10__cw_device_owners;
    ELSE
      expected := t.old_before + t.new_before;
    END IF;
    -- The new sensor is live: the ingest may commit one more reading for it while this runs, so
    -- for cw_air_data "at least" is the correct test (the exact per-row check follows below).
    -- Nothing else writes to the other tables for either EUI, so those must match exactly.
    IF (t.kind = 'air' AND c_new < expected) OR (t.kind <> 'air' AND c_new <> expected) THEN
      RAISE EXCEPTION 'VERIFY FAILED: % has % row(s) for the new device, expected %', t.tbl, c_new, expected;
    END IF;

    IF t.old_before > 0 THEN
      summary := summary || format('%s %s->%s | ', t.tbl, t.old_before, c_new);
    END IF;
  END LOOP;

  -- every reading that was backed up is now under the new EUI, untouched
  SELECT count(*) INTO n
    FROM maintenance.devswap_5722_to_7a10__cw_air_data_keys k
   WHERE NOT EXISTS (SELECT 1 FROM public.cw_air_data a WHERE a.dev_eui = p.new_eui AND a.created_at = k.created_at);
  IF n <> 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: % backed-up reading(s) are not present under the new device', n;
  END IF;

  -- every user keeps exactly the permission level they had on the old device
  SELECT count(*) INTO n
    FROM maintenance.devswap_5722_to_7a10__cw_device_owners b
   WHERE b.dev_eui = p.old_eui
     AND NOT EXISTS (SELECT 1 FROM public.cw_device_owners o
                      WHERE o.dev_eui = p.new_eui AND o.user_id = b.user_id AND o.permission_level = b.permission_level);
  IF n <> 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: % user permission(s) did not carry over unchanged', n;
  END IF;

  -- the rule state moved bit-for-bit (in particular is_triggered)
  SELECT count(*) INTO n
    FROM maintenance.devswap_5722_to_7a10__cw_rule_state b
   WHERE NOT EXISTS (SELECT 1 FROM public.cw_rule_state s
                      WHERE s.id = b.id AND s.dev_eui = p.new_eui AND s.template_id = b.template_id
                        AND s.is_triggered = b.is_triggered
                        AND s.last_triggered_at IS NOT DISTINCT FROM b.last_triggered_at
                        AND s.last_reset_at     IS NOT DISTINCT FROM b.last_reset_at);
  IF n <> 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: % rule state row(s) did not carry over unchanged', n;
  END IF;

  -- the device rows
  PERFORM 1 FROM public.cw_devices WHERE dev_eui = p.new_eui AND name = p.expected_name AND location_id = p.expected_location;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'VERIFY FAILED: new device row is missing, misnamed or in the wrong location';
  END IF;
  SELECT count(*) INTO n FROM public.cw_devices WHERE dev_eui = p.old_eui;
  IF (p.old_device_action = 'delete' AND n <> 0) OR (p.old_device_action = 'rename' AND n <> 1) THEN
    RAISE EXCEPTION 'VERIFY FAILED: old device row count is % after action "%"', n, p.old_device_action;
  END IF;
  SELECT count(*) INTO n FROM public.cw_devices WHERE name = p.expected_name AND location_id = p.expected_location;
  IF n <> 1 THEN
    RAISE EXCEPTION 'VERIFY FAILED: % devices are named "%" in location %, expected exactly 1', n, p.expected_name, p.expected_location;
  END IF;

  summary := summary || format('old device row: %s', p.old_device_action);
  RAISE NOTICE 'All checks passed. %', summary;

  -- keep the before/after counts with the backups (02_rollback.sql reads them)
  CREATE TABLE maintenance.devswap_5722_to_7a10__counts AS SELECT * FROM _swap_counts;

  IF p.dry_run THEN
    RAISE EXCEPTION 'DRY RUN OK — every check passed and NOTHING was changed (rolled back on purpose). Would do: %  >>> set dry_run = FALSE to apply.', summary;
  END IF;
END
$chk$;

COMMIT;

-- -----------------------------------------------------------------------------
-- 9. RESULT (only reached when applied). Expect old_readings 0 and new_readings = 12,227 + the
--    new sensor's own readings; "own_sensor_readings" is that second part (67 when this was
--    written, growing by one every ~10 minutes).
-- -----------------------------------------------------------------------------
SELECT l.ran_at,
       l.old_eui,
       (SELECT name FROM public.cw_devices d WHERE d.dev_eui = l.old_eui)                          AS old_device_name,
       l.new_eui,
       (SELECT name FROM public.cw_devices d WHERE d.dev_eui = l.new_eui)                          AS new_device_name,
       (SELECT count(*) FROM public.cw_air_data a WHERE a.dev_eui = l.old_eui)                     AS old_readings,
       (SELECT count(*) FROM public.cw_air_data a WHERE a.dev_eui = l.new_eui)                     AS new_readings,
       (SELECT count(*) FROM public.cw_air_data a WHERE a.dev_eui = l.new_eui
                                                    AND a.created_at > l.old_history_last_reading) AS own_sensor_readings,
       (SELECT count(*) FROM public.cw_device_owners o WHERE o.dev_eui = l.new_eui)                AS new_owner_rows,
       (SELECT count(*) FROM public.cw_device_rule_assignments r WHERE r.dev_eui = l.new_eui)      AS new_rule_assignments,
       (SELECT bool_or(is_triggered) FROM public.cw_rule_state s WHERE s.dev_eui = l.new_eui)      AS rule_is_triggered,
       (SELECT count(*) FROM public.cw_rule_trigger_log g WHERE g.dev_eui = l.new_eui)             AS new_trigger_log_rows,
       (SELECT count(*) FROM public.cw_device_report_assignments r WHERE r.dev_eui = l.new_eui)    AS new_report_assignments
  FROM maintenance.devswap_5722_to_7a10__log l;
