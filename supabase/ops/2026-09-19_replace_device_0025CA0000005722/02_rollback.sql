-- =============================================================================
-- 02_rollback.sql — undo 01_replace_device.sql using the backups it took in the
-- "maintenance" schema. Only needed if the replacement has to be reversed.
--
-- What it does
--   * restores the old cw_devices row exactly as it was (re-creates it if it was deleted)
--   * moves back exactly the rows that were moved: readings by their backed-up
--     (created_at) keys, everything else by primary key
--   * re-creates owner rows that were merged away, and gives owner rows that already
--     existed on the new device their original permission level back
--   * the NEW device row: deleted if 01 created it and nothing references it any more;
--     otherwise kept and renamed (so two devices never share the freezer's name).
--     Readings the new sensor produced AFTER the cut-over are left under the new EUI.
--
-- Values that changed legitimately after the cut-over (for example the rule state being
-- reset by the alert engine) are moved back as they are now, not overwritten.
--
-- Same safety model as 01: dry_run = TRUE rehearses and aborts on purpose.
-- The backup tables are left in place; drop the schema by hand when you no longer need them.
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';

CREATE TEMP TABLE _rb ON COMMIT DROP AS
SELECT TRUE AS dry_run;      -- TRUE = rehearse and roll back | FALSE = apply

-- -----------------------------------------------------------------------------
-- 1. PRE-FLIGHT
-- -----------------------------------------------------------------------------
DO $pre$
DECLARE
  l  record;
  n  bigint;
BEGIN
  IF to_regclass('maintenance.devswap_5722_to_7a10__log') IS NULL THEN
    RAISE EXCEPTION 'No backup found (maintenance.devswap_5722_to_7a10__log) — 01_replace_device.sql was never applied here';
  END IF;
  SELECT * INTO STRICT l FROM maintenance.devswap_5722_to_7a10__log;

  PERFORM 1 FROM public.cw_devices WHERE dev_eui = l.new_eui FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'New device % is not in cw_devices — nothing to roll back', l.new_eui;
  END IF;

  -- rows in the "generic" tables are not individually backed up; refuse if any were moved
  SELECT count(*) INTO n FROM maintenance.devswap_5722_to_7a10__counts WHERE kind = 'generic' AND old_before > 0;
  IF n > 0 THEN
    RAISE EXCEPTION '01 moved rows in % generic table(s); those need a manual rollback', n;
  END IF;

  -- the old EUI must not have acquired readings of its own in the meantime
  SELECT count(*) INTO n
    FROM public.cw_air_data a JOIN maintenance.devswap_5722_to_7a10__cw_air_data_keys k
      ON a.dev_eui = l.old_eui AND a.created_at = k.created_at;
  IF n > 0 THEN
    RAISE EXCEPTION '% reading(s) already exist under the old EUI at backed-up timestamps — already rolled back?', n;
  END IF;
END
$pre$;

-- -----------------------------------------------------------------------------
-- 2. THE OLD DEVICE ROW — back exactly as it was
-- -----------------------------------------------------------------------------
DELETE FROM public.cw_devices d
 USING maintenance.devswap_5722_to_7a10__log l
 WHERE d.dev_eui = l.old_eui;          -- a tombstone has no children, so this cascades to nothing

INSERT INTO public.cw_devices
SELECT b.* FROM maintenance.devswap_5722_to_7a10__cw_devices b
  JOIN maintenance.devswap_5722_to_7a10__log l ON b.dev_eui = l.old_eui;

-- -----------------------------------------------------------------------------
-- 3. HISTORY — exactly the backed-up readings (cascades to cw_air_alerts / cw_air_annotations)
-- -----------------------------------------------------------------------------
UPDATE public.cw_air_data a
   SET dev_eui = l.old_eui
  FROM maintenance.devswap_5722_to_7a10__cw_air_data_keys k, maintenance.devswap_5722_to_7a10__log l
 WHERE a.dev_eui = l.new_eui AND a.created_at = k.created_at;

UPDATE public.cw_air_alerts x SET dev_eui = b.dev_eui
  FROM maintenance.devswap_5722_to_7a10__cw_air_alerts b WHERE x.id = b.id AND x.dev_eui <> b.dev_eui;

UPDATE public.cw_air_annotations x SET dev_eui = b.dev_eui
  FROM maintenance.devswap_5722_to_7a10__cw_air_annotations b WHERE x.id = b.id AND x.dev_eui <> b.dev_eui;

-- -----------------------------------------------------------------------------
-- 4. USER PERMISSIONS
-- -----------------------------------------------------------------------------
-- rows that were moved: back to the old EUI (by primary key)
UPDATE public.cw_device_owners o SET dev_eui = b.dev_eui
  FROM maintenance.devswap_5722_to_7a10__cw_device_owners b, maintenance.devswap_5722_to_7a10__log l
 WHERE o.id = b.id AND b.dev_eui = l.old_eui;

-- rows that were merged away (the user already had a row on the new device): re-create them
INSERT INTO public.cw_device_owners
SELECT b.* FROM maintenance.devswap_5722_to_7a10__cw_device_owners b
  JOIN maintenance.devswap_5722_to_7a10__log l ON b.dev_eui = l.old_eui
 WHERE NOT EXISTS (SELECT 1 FROM public.cw_device_owners o WHERE o.id = b.id);

-- rows that already existed on the new device: their original permission level
UPDATE public.cw_device_owners o SET permission_level = b.permission_level
  FROM maintenance.devswap_5722_to_7a10__cw_device_owners b, maintenance.devswap_5722_to_7a10__log l
 WHERE o.id = b.id AND b.dev_eui = l.new_eui;

-- -----------------------------------------------------------------------------
-- 5. RULES AND REPORTS — by primary key
-- -----------------------------------------------------------------------------
UPDATE public.cw_device_rule_assignments x SET dev_eui = b.dev_eui
  FROM maintenance.devswap_5722_to_7a10__cw_device_rule_assignments b WHERE x.id = b.id;
UPDATE public.cw_device_report_assignments x SET dev_eui = b.dev_eui
  FROM maintenance.devswap_5722_to_7a10__cw_device_report_assignments b WHERE x.id = b.id;
UPDATE public.cw_rule_state x SET dev_eui = b.dev_eui
  FROM maintenance.devswap_5722_to_7a10__cw_rule_state b WHERE x.id = b.id;
UPDATE public.cw_rule_trigger_log x SET dev_eui = b.dev_eui
  FROM maintenance.devswap_5722_to_7a10__cw_rule_trigger_log b WHERE x.id = b.id;
UPDATE public.cw_rule_monthly_usage x SET dev_eui = b.dev_eui
  FROM maintenance.devswap_5722_to_7a10__cw_rule_monthly_usage b WHERE x.id = b.id;

-- -----------------------------------------------------------------------------
-- 6. THE NEW DEVICE ROW
-- -----------------------------------------------------------------------------
-- present before 01 ran: every column 01 touched goes back to what it was. last_data_updated_at is
-- only put back while it still holds the value 01 carried over from the old device; if the new
-- sensor has reported since, its own newer timestamp is the truth and is left alone.
UPDATE public.cw_devices d
   SET name = b.name, location_id = b.location_id, user_id = b.user_id, "group" = b."group",
       upload_interval = b.upload_interval,
       last_data_updated_at = CASE
         WHEN d.last_data_updated_at IS NOT DISTINCT FROM bo.last_data_updated_at THEN b.last_data_updated_at
         ELSE d.last_data_updated_at END
  FROM maintenance.devswap_5722_to_7a10__cw_devices b,
       maintenance.devswap_5722_to_7a10__cw_devices bo,
       maintenance.devswap_5722_to_7a10__log l
 WHERE d.dev_eui = l.new_eui AND b.dev_eui = l.new_eui AND bo.dev_eui = l.old_eui;

-- created by 01: remove it if nothing references it, otherwise keep it under a distinct name
DO $new$
DECLARE
  l     record;
  refs  bigint;
BEGIN
  SELECT * INTO STRICT l FROM maintenance.devswap_5722_to_7a10__log;
  IF NOT l.created_new_device_row THEN
    RETURN;
  END IF;

  SELECT (SELECT count(*) FROM public.cw_air_data                  WHERE dev_eui = l.new_eui)
       + (SELECT count(*) FROM public.cw_device_owners             WHERE dev_eui = l.new_eui)
       + (SELECT count(*) FROM public.cw_device_rule_assignments   WHERE dev_eui = l.new_eui)
       + (SELECT count(*) FROM public.cw_device_report_assignments WHERE dev_eui = l.new_eui)
       + (SELECT count(*) FROM public.cw_rule_state                WHERE dev_eui = l.new_eui)
       + (SELECT count(*) FROM public.cw_rule_trigger_log          WHERE dev_eui = l.new_eui)
    INTO refs;

  IF refs = 0 THEN
    DELETE FROM public.cw_devices WHERE dev_eui = l.new_eui;
    RAISE NOTICE 'New device row % removed (it was created by 01 and nothing references it).', l.new_eui;
  ELSE
    UPDATE public.cw_devices SET name = name || '（交換機 ' || l.new_eui || '）' WHERE dev_eui = l.new_eui;
    RAISE NOTICE 'New device row % KEPT and renamed: % row(s) still reference it (data produced after the cut-over).', l.new_eui, refs;
  END IF;
END
$new$;

-- -----------------------------------------------------------------------------
-- 7. VERIFY
-- -----------------------------------------------------------------------------
DO $chk$
DECLARE
  l  record;
  n  bigint;
BEGIN
  SELECT * INTO STRICT l FROM maintenance.devswap_5722_to_7a10__log;

  SELECT count(*) INTO n FROM maintenance.devswap_5722_to_7a10__cw_air_data_keys k
   WHERE NOT EXISTS (SELECT 1 FROM public.cw_air_data a WHERE a.dev_eui = l.old_eui AND a.created_at = k.created_at);
  IF n <> 0 THEN RAISE EXCEPTION 'VERIFY FAILED: % backed-up reading(s) are not back under the old device', n; END IF;

  SELECT count(*) INTO n FROM maintenance.devswap_5722_to_7a10__cw_device_owners b
   WHERE NOT EXISTS (SELECT 1 FROM public.cw_device_owners o
                      WHERE o.id = b.id AND o.dev_eui = b.dev_eui AND o.user_id = b.user_id
                        AND o.permission_level = b.permission_level);
  IF n <> 0 THEN RAISE EXCEPTION 'VERIFY FAILED: % owner row(s) are not back as they were', n; END IF;

  SELECT (SELECT count(*) FROM maintenance.devswap_5722_to_7a10__cw_device_rule_assignments b
           WHERE NOT EXISTS (SELECT 1 FROM public.cw_device_rule_assignments x WHERE x.id = b.id AND x.dev_eui = b.dev_eui))
       + (SELECT count(*) FROM maintenance.devswap_5722_to_7a10__cw_device_report_assignments b
           WHERE NOT EXISTS (SELECT 1 FROM public.cw_device_report_assignments x WHERE x.id = b.id AND x.dev_eui = b.dev_eui))
       + (SELECT count(*) FROM maintenance.devswap_5722_to_7a10__cw_rule_state b
           WHERE NOT EXISTS (SELECT 1 FROM public.cw_rule_state x WHERE x.id = b.id AND x.dev_eui = b.dev_eui))
       + (SELECT count(*) FROM maintenance.devswap_5722_to_7a10__cw_rule_trigger_log b
           WHERE NOT EXISTS (SELECT 1 FROM public.cw_rule_trigger_log x WHERE x.id = b.id AND x.dev_eui = b.dev_eui))
    INTO n;
  IF n <> 0 THEN RAISE EXCEPTION 'VERIFY FAILED: % rule/report row(s) are not back under the old device', n; END IF;

  SELECT count(*) INTO n FROM public.cw_devices d JOIN maintenance.devswap_5722_to_7a10__cw_devices b
    ON d.dev_eui = b.dev_eui AND b.dev_eui = l.old_eui AND to_jsonb(d) = to_jsonb(b);
  IF n <> 1 THEN RAISE EXCEPTION 'VERIFY FAILED: the old device row is not identical to its backup'; END IF;

  RAISE NOTICE 'Rollback checks passed.';
  IF (SELECT dry_run FROM _rb) THEN
    RAISE EXCEPTION 'DRY RUN OK — the rollback would succeed and NOTHING was changed (rolled back on purpose)  >>> set dry_run = FALSE to apply.';
  END IF;
END
$chk$;

COMMIT;

SELECT d.dev_eui, d.name, d.location_id,
       (SELECT count(*) FROM public.cw_air_data a WHERE a.dev_eui = d.dev_eui)                  AS readings,
       (SELECT count(*) FROM public.cw_device_owners o WHERE o.dev_eui = d.dev_eui)             AS owner_rows,
       (SELECT count(*) FROM public.cw_device_rule_assignments r WHERE r.dev_eui = d.dev_eui)   AS rule_assignments,
       (SELECT count(*) FROM public.cw_device_report_assignments r WHERE r.dev_eui = d.dev_eui) AS report_assignments
  FROM public.cw_devices d
 WHERE d.dev_eui IN (SELECT old_eui FROM maintenance.devswap_5722_to_7a10__log
                     UNION ALL SELECT new_eui FROM maintenance.devswap_5722_to_7a10__log)
 ORDER BY d.dev_eui;
