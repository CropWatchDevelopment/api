-- =============================================================================
-- 04_delete_old_device.sql — remove the tombstone of the replaced sensor.
--
-- 01_replace_device.sql (applied 2026-09-19 00:32 JST, old_device_action = 'rename') left
-- 0025CA0000005722 in cw_devices as
--     "トンネルフリーザー1（交換済 → 3436343159337A10）"
-- with nothing referencing it. This deletes that one row. The original row is preserved in
-- maintenance.devswap_5722_to_7a10__cw_devices, and 02_rollback.sql re-creates it from there,
-- so the rollback keeps working after this.
--
-- It refuses to run unless: the row is that tombstone, 01's backup exists, the replacement
-- device is in place with the history, and NO table has a row for the old EUI — the FKs to
-- cw_devices are mostly ON DELETE CASCADE, so a stray child row would be deleted silently.
--
-- Same safety model: dry_run = TRUE rehearses and aborts on purpose with "DRY RUN OK".
-- DBeaver: after the dry run (or any error) run a lone  ROLLBACK;  before the next attempt.
--
-- After this, an uplink from the old EUI would find no device and cycle the ingest's
-- dead-letter queue — delete the device in TTS too (cw-jp-air-th / eui-0025ca0000005722).
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '2min';

CREATE TEMP TABLE _del ON COMMIT DROP AS
SELECT
  '0025CA0000005722'::varchar AS old_eui,
  '3436343159337A10'::varchar AS new_eui,
  TRUE                        AS dry_run;     -- TRUE = rehearse and roll back | FALSE = apply

DO $del$
DECLARE
  p     record;
  d     public.cw_devices%ROWTYPE;
  t     text;
  n     bigint;
  gone  bigint;
BEGIN
  SELECT * INTO STRICT p FROM _del;

  IF to_regclass('maintenance.devswap_5722_to_7a10__cw_devices') IS NULL THEN
    RAISE EXCEPTION 'Backup table maintenance.devswap_5722_to_7a10__cw_devices not found — refusing to delete without it';
  END IF;
  PERFORM 1 FROM maintenance.devswap_5722_to_7a10__cw_devices WHERE dev_eui = p.old_eui;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The backup does not contain the old device row — refusing to delete';
  END IF;

  SELECT * INTO d FROM public.cw_devices WHERE dev_eui = p.old_eui FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Old device % is not in cw_devices — already deleted', p.old_eui;
  END IF;
  IF d.name NOT LIKE '%（交換済 → ' || p.new_eui || '）' THEN
    RAISE EXCEPTION 'Old device is named "%", which is not the tombstone 01 leaves behind — refusing', d.name;
  END IF;

  -- the replacement must be in place and hold the history
  PERFORM 1 FROM public.cw_devices WHERE dev_eui = p.new_eui AND location_id = d.location_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Replacement device % is not in cw_devices at location % — refusing', p.new_eui, d.location_id;
  END IF;
  SELECT count(*) INTO n FROM maintenance.devswap_5722_to_7a10__cw_air_data_keys k
   WHERE NOT EXISTS (SELECT 1 FROM public.cw_air_data a WHERE a.dev_eui = p.new_eui AND a.created_at = k.created_at);
  IF n <> 0 THEN
    RAISE EXCEPTION '% migrated reading(s) are not under the replacement device — refusing', n;
  END IF;

  -- nothing may reference the old EUI (every table that has a dev_eui column)
  FOREACH t IN ARRAY ARRAY[
    'cw_air_data','cw_air_alerts','cw_air_annotations','cw_device_owners','cw_device_gateway',
    'cw_device_rule_assignments','cw_device_report_assignments','cw_rule_state','cw_rule_trigger_log',
    'cw_rule_monthly_usage','cw_soil_data','cw_water_data','cw_power_data','cw_relay_data','cw_traffic2',
    'cw_watermeter_uplinks','device_licenses','cw_report_regeneration_queue','ip_log']
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE dev_eui = $1', t) INTO n USING p.old_eui;
    IF n <> 0 THEN
      RAISE EXCEPTION '% still has % row(s) for the old device — refusing (deleting would cascade to them)', t, n;
    END IF;
  END LOOP;

  DELETE FROM public.cw_devices WHERE dev_eui = p.old_eui;
  GET DIAGNOSTICS gone = ROW_COUNT;
  IF gone <> 1 THEN
    RAISE EXCEPTION 'Expected to delete exactly 1 row, deleted %', gone;
  END IF;

  SELECT count(*) INTO n FROM public.cw_devices WHERE location_id = d.location_id AND name LIKE 'トンネルフリーザー1%';
  IF n <> 1 THEN
    RAISE EXCEPTION 'VERIFY FAILED: % device(s) named トンネルフリーザー1* remain in location %, expected exactly 1', n, d.location_id;
  END IF;

  IF p.dry_run THEN
    RAISE EXCEPTION 'DRY RUN OK — would delete cw_devices row % ("%"); nothing references it; NOTHING was changed  >>> set dry_run = FALSE to apply.', p.old_eui, d.name;
  END IF;
END
$del$;

COMMIT;

SELECT (SELECT count(*) FROM public.cw_devices WHERE dev_eui = '0025CA0000005722')            AS old_device_rows,
       (SELECT name FROM public.cw_devices WHERE dev_eui = '3436343159337A10')                AS replacement_name,
       (SELECT count(*) FROM public.cw_air_data WHERE dev_eui = '3436343159337A10')           AS replacement_readings,
       (SELECT count(*) FROM maintenance.devswap_5722_to_7a10__cw_devices
         WHERE dev_eui = '0025CA0000005722')                                                  AS old_row_still_in_backup;
