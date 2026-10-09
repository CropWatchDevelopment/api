-- =============================================================================
-- 028_delete_device.sql
-- =============================================================================
-- Device deletion (DELETE /v1/devices/:dev_eui).
--
--  A) cw_air_annotations (dev_eui, created_at) index. That pair is the FK to
--     cw_air_data (ON DELETE CASCADE) but had no supporting index, so every
--     deleted cw_air_data row cost a sequential scan of cw_air_annotations —
--     fine at today's ~550 notes, a statement timeout as notes grow.
--  B) purge_device_data_batch(dev_eui, batch_size)
--       Deletes up to batch_size sensor rows per call, one table at a time.
--       cw_air_data alone is ~2.5 GB / 10M rows (one device holds 760k); a
--       single DELETE of that size would blow PostgREST's 8s
--       statement_timeout, so the API calls this in a loop until it returns
--       0, then calls delete_device. Each batch walks the table's
--       (dev_eui, <time>) index via ORDER BY: without it the planner picks
--       Seq Scan + LIMIT for big devices, and once their rows thin out
--       (statistics still say ~750k) that rescans the whole table per batch.
--  C) delete_device(dev_eui)
--       One transaction: frees the device's licenses (status back to
--       'unassigned' — the FK's ON DELETE SET NULL alone would leave them
--       'assigned' with no device), purges any sensor rows that arrived after
--       the API's last purge call, clears the small dev_eui tables that have
--       no cascading FK to cw_devices (cw_watermeter_uplinks' FK is
--       NO ACTION and would block the delete), then deletes the cw_devices
--       row; every other child table cascades. Returns per-table counts.
--
-- cw_air_alerts: its FK to cw_air_data (dev_eui, air_created_at) is
-- ON DELETE SET NULL, which nulls BOTH columns, and cw_air_alerts.dev_eui is
-- NOT NULL — deleting an air row that an alert points at raises a not-null
-- violation. The purge therefore deletes the device's alert row before any
-- air data, on every call.
--
-- Authorization is NOT done here — the API checks Action.DeviceDelete before
-- calling either function. EXECUTE is service_role only (005 posture). Run as
-- postgres (the SQL editor default): the functions are SECURITY DEFINER and
-- rely on the owner bypassing RLS.
--
-- Additive and idempotent (IF NOT EXISTS / CREATE OR REPLACE). Run BEFORE
-- deploying the device-delete API release. database.types.ts only needs the
-- two new Functions entries.
-- Rollback: bottom of file.
-- =============================================================================

BEGIN;

-- A) FK-supporting index ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS cw_air_annotations_dev_eui_created_at_idx
  ON public.cw_air_annotations (dev_eui, created_at);

-- B) purge_device_data_batch --------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purge_device_data_batch(
  p_dev_eui    text,
  p_batch_size integer DEFAULT 10000
) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
    AS $$
DECLARE
  -- {table, order column}: each table has a (dev_eui, <order column>) index.
  v_targets text[] := ARRAY[
    ['cw_air_data',   'created_at'],
    ['cw_soil_data',  'created_at'],
    ['cw_traffic2',   'traffic_hour'],
    ['cw_water_data', 'created_at']
  ];
  v_i       integer;
  v_deleted integer;
BEGIN
  IF p_dev_eui IS NULL OR btrim(p_dev_eui) = '' THEN
    RAISE EXCEPTION 'DEV_EUI_REQUIRED';
  END IF;
  IF p_batch_size IS NULL OR p_batch_size < 1 OR p_batch_size > 50000 THEN
    RAISE EXCEPTION 'INVALID_BATCH_SIZE';
  END IF;

  -- Must precede any cw_air_data delete (see header). Unique per device.
  DELETE FROM cw_air_alerts WHERE dev_eui = p_dev_eui;

  FOR v_i IN 1 .. array_length(v_targets, 1) LOOP
    EXECUTE format(
      'DELETE FROM public.%1$I WHERE ctid = ANY (ARRAY(
         SELECT ctid FROM public.%1$I WHERE dev_eui = $1 ORDER BY %2$I LIMIT $2))',
      v_targets[v_i][1], v_targets[v_i][2])
      USING p_dev_eui, p_batch_size;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    IF v_deleted > 0 THEN
      RETURN v_deleted;
    END IF;
  END LOOP;

  RETURN 0;
END;
$$;

-- C) delete_device -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_device(
  p_dev_eui text
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
    AS $$
DECLARE
  v_counts jsonb := '{}'::jsonb;
  v_n      integer;
  v_late   integer := 0;
  v_table  text;
BEGIN
  PERFORM 1 FROM cw_devices WHERE dev_eui = p_dev_eui FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DEVICE_NOT_FOUND';
  END IF;

  -- Free the seat so it can be assigned to another device.
  UPDATE device_licenses
     SET dev_eui = NULL, status = 'unassigned', updated_at = now()
   WHERE dev_eui = p_dev_eui;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('device_licenses_freed', v_n);

  -- Sensor rows that arrived after the API's last purge call (normally none);
  -- also clears cw_air_alerts first, like every purge call.
  LOOP
    v_n := purge_device_data_batch(p_dev_eui, 10000);
    EXIT WHEN v_n = 0;
    v_late := v_late + v_n;
  END LOOP;
  IF v_late > 0 THEN
    v_counts := v_counts || jsonb_build_object('late_sensor_rows', v_late);
  END IF;

  -- Small dev_eui-keyed tables without a cascading FK to cw_devices.
  FOREACH v_table IN ARRAY ARRAY[
    'cw_air_annotations', 'cw_rule_monthly_usage', 'cw_rule_state',
    'cw_watermeter_uplinks'
  ]
  LOOP
    EXECUTE format('DELETE FROM public.%I WHERE dev_eui = $1', v_table)
      USING p_dev_eui;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n > 0 THEN
      v_counts := v_counts || jsonb_build_object(v_table, v_n);
    END IF;
  END LOOP;

  -- Everything else (owners, traffic/water/power/relay data, gateway links,
  -- rule/report assignments, trigger log, ip_log, regeneration queue)
  -- goes via ON DELETE CASCADE.
  DELETE FROM cw_devices WHERE dev_eui = p_dev_eui;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'DEVICE_DELETE_FAILED: % rows deleted', v_n;
  END IF;

  RETURN jsonb_build_object('dev_eui', p_dev_eui, 'deleted', v_counts);
END;
$$;

REVOKE ALL ON FUNCTION public.purge_device_data_batch(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_device(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_device_data_batch(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_device(text) TO service_role;

COMMIT;

-- =============================================================================
-- OPS — verification (read-only, run right after COMMIT)
-- =============================================================================
-- SELECT p.proname, p.prosecdef, pg_get_userbyid(p.proowner) AS owner, p.proconfig,
--        has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon_exec,
--        has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_exec,
--        has_function_privilege('service_role',  p.oid, 'EXECUTE') AS service_exec
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE n.nspname = 'public' AND p.proname IN ('purge_device_data_batch', 'delete_device');
-- -- expect: prosecdef = t, owner = postgres, anon_exec = f,
-- --         authenticated_exec = f, service_exec = t
-- SELECT indexname FROM pg_indexes
--  WHERE tablename = 'cw_air_annotations' AND indexname = 'cw_air_annotations_dev_eui_created_at_idx';

-- =============================================================================
-- ROLLBACK
-- =============================================================================
-- DROP FUNCTION IF EXISTS public.delete_device(text);
-- DROP FUNCTION IF EXISTS public.purge_device_data_batch(text, integer);
-- DROP INDEX IF EXISTS public.cw_air_annotations_dev_eui_created_at_idx;
