-- =============================================================================
-- 01_swap_sensors.sql
--
-- TK-Ebisu, 2026-10-28 — three sensors changed places:
--   2CF7F1C061700171 (SenseCAP S2101) was the factory fridge's sensor
--     (工場冷蔵庫, location 59) since 2024-08-02. It was taken out of the fridge
--     at ~09:50 JST and put into freezer container 冷凍コンテナ3 (location 82)
--     at ~11:10 JST, replacing
--   2CF7F1C053000110 (SenseCAP S2103), the container's sensor since 2025-01-05,
--     which was taken out at the same moment and is retired.
--   343634315F33780C (CropWatch air T/H) is the fridge's new sensor; its first
--     reading is 21:05 JST.
--
-- After this script each EUI carries the history of the PLACE it now measures:
--   343634315F33780C = 工場冷蔵庫:  the fridge readings of 2CF7F1C061700171 up to
--                      09:50 JST, then its own (from 21:05 JST); the history (trigger
--                      log) of the fridge's two alarms — the alarms themselves were
--                      already moved here in the UI; the 工場冷蔵庫 weekly report.
--   2CF7F1C061700171 = 冷凍コンテナ3: the container readings of 2CF7F1C053000110 up
--                      to 11:10 JST, then its own; the container's two alarms with
--                      state and log; the 冷凍コンテナ③ weekly report; and the user
--                      permissions the customer had on the container's sensor.
--   2CF7F1C053000110 = tombstone "冷凍コンテナ③（交換済 → 2CF7F1C061700171）"
--                      keeping only its 5 readings from after it was pulled out.
--
-- THE CUT-OVER TIMES come from the readings, not the clock (all JST):
--   2CF7F1C061700171  09:48  +2.58 C  100 %RH   last reading in the fridge
--                     09:58 +11.46 C            out of the fridge
--                     10:08 .. 11:08  +15 .. +20 C, 80-100 %RH   in transit (8 readings)
--                     11:18 +13.66 C   24 %RH   in the container (dry freezer air),
--                     11:28  -9.00 C, cooling to -19 C by 14:00
--   2CF7F1C053000110  11:04 -22.12 C            last reading in the container
--                     11:19  -1.75 C, then +20 .. +27 C   pulled out
--   fridge_end = 09:50 JST and container_swap = 11:10 JST split those cleanly.
--
--   The 8 transit readings (09:58-11:08 JST) were taken in neither place. Left
--   under 2CF7F1C061700171 they would interleave with the container readings
--   moved in from 2CF7F1C053000110 (which reads -22 C at :04/:19/:34/:49) and put
--   a fake +20 C excursion into the container's report, so they are REMOVED from
--   cw_air_data — copied in full to the backup first; UNDO_swap_sensors.sql puts them
--   back.
--
-- STATE WHEN THIS WAS WRITTEN (read-only survey, 2026-10-29 ~16:30 JST, re-surveyed
-- ~17:15 JST after the alarms were edited in the UI at 16:55-17:05 JST):
--   2CF7F1C061700171 "冷凍コンテナ3"  loc 82 type 12 | cw_air_data 130,650 before
--       fridge_end + 8 transit + own (live, every 10 min) | annotations 100 (all
--       before fridge_end) | NO rules: the UI took fridge alarms 21/22 off it and
--       deleted their state rows | trigger log 46, all 21/22 (43 before
--       fridge_end) | report template 1 "工場冷蔵庫" | owners 5 (customers at
--       5 = Disabled, sayaka at 1 = Admin: the pattern a location move in the UI
--       leaves, see docs/permission-model.md "Moving a device between locations")
--   2CF7F1C053000110 "冷凍コンテナ③"  loc 82 type 6 | cw_air_data 90,226 before
--       container_swap + 5 after, silent since 12:19 JST | annotations 164 |
--       rules 17, 19 (container alarms; re-saved in the UI on 10-29 still on THIS
--       retired sensor, shared with ...0124, ...0183 and 原料冷凍庫 323833324F327E04)
--       + state, BOTH TRIGGERED by the pull-out | trigger log 11 | report
--       template 4 "冷凍コンテナ③" | owners 7
--   343634315F33780C "工場冷蔵庫"     loc 59 type 2 | cw_air_data from 21:05 JST |
--       rules 21, 22 (moved here in the UI on 10-29, shared with 原料冷蔵庫
--       323833327F327415), both TRIGGERED at 16:58 JST (11.23 C) with 2 open log
--       rows | no report, no annotations | owners 5
--   Rule templates 21/22 already carry device type 2 (set by the UI). No row in
--   cw_air_alerts, or in cw_rule_monthly_usage for the two old sensors; no
--   triggers on the touched tables except org_cap_guest_device_grant on
--   cw_device_owners (no guests in this organization, so it does not fire).
--
-- THE FRIDGE'S ALARMS ARE NOT TOUCHED: assignments, state and live log rows on
-- 343634315F33780C stay exactly as the UI left them. The container's alarms and
-- both reports are moved by template id; if the receiving sensor already has
-- that template (e.g. 17/19 added to 2CF7F1C061700171 in the UI before this
-- runs), the receiving row and its state win and the sending row is dropped
-- (kept in the backup, listed in ..._dropped, restored by UNDO_swap_sensors.sql).
--
-- NOT MOVED (they describe the radio, not the place): cw_device_gateway,
-- cw_device_status(_events), device_licenses, cw_soil_data (343634315F33780C has
-- 170 soil rows from 09-29..10-25 — earlier testing, not shown for an air sensor),
-- 343634315F33780C's user permissions (2CF7F1C061700171's fridge permissions were
-- deleted by the location move and cannot be recovered — set them in the UI).
-- cw_device_activity_hourly (overview uplink counts) is recounted for the three
-- EUIs from the moved telemetry.
--
-- HOW TO RUN
--   1. Leave dry_run = TRUE and run the whole file. It performs the complete
--      swap, verifies it, then ABORTS ON PURPOSE with "DRY RUN OK ...". Nothing
--      is changed.
--   2. Set dry_run = FALSE and run it again to apply. The last statement prints
--      the resulting state.
--   psql:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 01_swap_sensors.sql
--   Any failed check raises an exception, which rolls back EVERYTHING.
--   ~221k readings are re-keyed in one transaction. On production this takes
--   SEVERAL MINUTES (a full run on 2026-10-29: ~3.5 min; the two big UPDATEs
--   ~40 s and ~30 s) and DBeaver shows no progress meanwhile — do not cancel.
--   Every run that is cancelled or fails after the UPDATEs leaves ~220k dead row
--   versions behind and makes the next run slower; run
--   VACUUM (ANALYZE) public.cw_air_data;  before retrying (see the README).
--
-- *** WHAT HAPPENS THE MOMENT THIS COMMITS — READ THIS ***
--   All four alarm actions are e-mail only, and none has revertOnReset, so a
--   RESET never sends anything (AlertDispatcher.dispatchReset); only a TRIGGER
--   does.
--   * Container (rules 17 ">= -10, reset -15" and 19 ">= 0, reset -8"): until
--     this commits, nothing evaluates 冷凍コンテナ3's real sensor. Their state
--     moves unchanged, still triggered from the pull-out (11:19 / 11:34 JST).
--     The next 2CF7F1C061700171 reading at or below -15 C resets both silently
--     and closes the two open log rows; from then on they fire on this
--     sensor's readings. NOTE: this sensor reads the container's warm spells
--     higher than the old one did — +6.95 C at 20:18 JST on its first evening,
--     where the old sensor's warmest in two weeks was -4.3 C — so rule 19
--     (>= 0), which the old sensor almost never tripped, will likely start
--     e-mailing. Check the sensor's placement or the thresholds.
--   * Fridge (rules 21, 22): nothing changes — they already run on
--     343634315F33780C. Its alarm history just gains the 43 closed fridge-era
--     log rows behind the two live ones.
--   * The 5 container users who were Disabled on 2CF7F1C061700171 see it with
--     their old 冷凍コンテナ③ permission level on their next page load.
--
-- NOT DONE HERE: the report PDFs in the "Reports" bucket are listed by EUI
-- folder, and the 15 container PDFs have the same file names as 15 of the 42
-- fridge PDFs in 2CF7F1C061700171/. 02_move_report_pdfs.py moves the fridge
-- PDFs to 343634315F33780C/ first, then copies the container PDFs in.
-- =============================================================================

-- Ends a transaction a previous run left aborted in the same session (DBeaver stops at the DRY RUN
-- error without rolling back); on a clean session it only prints "there is no transaction in progress".
ROLLBACK;

BEGIN;

SET LOCAL lock_timeout = '5s';          -- fail fast instead of queueing behind another writer
SET LOCAL statement_timeout = '10min';
SET LOCAL TimeZone = 'UTC';             -- the activity recount buckets by hour, like cw_device_activity_recompute

-- -----------------------------------------------------------------------------
-- 0. PARAMETERS — the only line you should need to touch is dry_run
-- -----------------------------------------------------------------------------
CREATE TEMP TABLE _swap ON COMMIT DROP AS
SELECT
  '2CF7F1C061700171'::varchar           AS moved_eui,        -- fridge -> container
  '2CF7F1C053000110'::varchar           AS retired_eui,      -- container, retired
  '343634315F33780C'::varchar           AS fridge_eui,       -- the fridge's new sensor
  timestamptz '2026-10-28 09:50:00+09'  AS fridge_end,       -- moved_eui readings before this -> fridge_eui
  timestamptz '2026-10-28 11:10:00+09'  AS container_swap,   -- retired_eui readings before this -> moved_eui;
                                                             -- moved_eui readings in [fridge_end, container_swap) are removed
  8                                     AS expected_transit, -- guard: exactly the 8 readings looked at (09:58 .. 11:08 JST)
  '{17,19}'::bigint[]                   AS container_rules,  -- 冷凍庫温度注意（-10℃以上） / 冷凍庫温度警報（0℃以上）: retired -> moved
  '{1}'::bigint[]                       AS fridge_reports,   -- 工場冷蔵庫: moved -> fridge
  '{4}'::bigint[]                       AS container_reports,-- 冷凍コンテナ③: retired -> moved
  TRUE                                  AS dry_run;          -- TRUE = rehearse and roll back | FALSE = apply

-- -----------------------------------------------------------------------------
-- 1. PRE-FLIGHT — refuse to run against anything unexpected
-- -----------------------------------------------------------------------------
DO $pre$
DECLARE
  p      record;
  d      public.cw_devices%ROWTYPE;
  n      bigint;
  ids    bigint[];
BEGIN
  SELECT * INTO STRICT p FROM _swap;

  -- The retired row is renamed: lock it. The two live rows only need to stay put; KEY SHARE
  -- blocks a rename/delete through the UI but not the ingest's metadata updates.
  SELECT * INTO d FROM public.cw_devices WHERE dev_eui = p.retired_eui FOR UPDATE;
  IF NOT FOUND OR d.name IS DISTINCT FROM '冷凍コンテナ③' OR d.location_id IS DISTINCT FROM 82 OR d.type IS DISTINCT FROM 6 THEN
    RAISE EXCEPTION 'Retired device % is missing or is not "冷凍コンテナ③" / location 82 / type 6 — already swapped (tombstone), or wrong database? (found "%", %, %)',
      p.retired_eui, d.name, d.location_id, d.type;
  END IF;
  SELECT * INTO d FROM public.cw_devices WHERE dev_eui = p.moved_eui FOR KEY SHARE;
  IF NOT FOUND OR d.name IS DISTINCT FROM '冷凍コンテナ3' OR d.location_id IS DISTINCT FROM 82 OR d.type IS DISTINCT FROM 12 THEN
    RAISE EXCEPTION 'Moved device % is missing or is not "冷凍コンテナ3" / location 82 / type 12 (found "%", %, %)',
      p.moved_eui, d.name, d.location_id, d.type;
  END IF;
  SELECT * INTO d FROM public.cw_devices WHERE dev_eui = p.fridge_eui FOR KEY SHARE;
  IF NOT FOUND OR d.name IS DISTINCT FROM '工場冷蔵庫' OR d.location_id IS DISTINCT FROM 59 THEN
    RAISE EXCEPTION 'Fridge device % is missing or is not "工場冷蔵庫" / location 59 (found "%", %)',
      p.fridge_eui, d.name, d.location_id;
  END IF;

  IF to_regclass('maintenance.devswap_0171_780c_0110__log') IS NOT NULL THEN
    RAISE EXCEPTION 'Backup maintenance.devswap_0171_780c_0110__log already exists — this swap was already applied';
  END IF;

  -- readings ------------------------------------------------------------------
  SELECT count(*) INTO n FROM public.cw_air_data WHERE dev_eui = p.fridge_eui AND created_at < p.fridge_end;
  IF n > 0 THEN
    RAISE EXCEPTION 'Fridge device % already has % reading(s) before fridge_end — the histories would collide', p.fridge_eui, n;
  END IF;
  SELECT count(*) INTO n FROM public.cw_air_data
   WHERE dev_eui = p.moved_eui AND created_at >= p.fridge_end AND created_at < p.container_swap;
  IF n <> p.expected_transit THEN
    RAISE EXCEPTION 'Expected % transit reading(s) for % between fridge_end and container_swap, found %',
      p.expected_transit, p.moved_eui, n;
  END IF;
  SELECT count(*) INTO n FROM public.cw_air_data WHERE dev_eui = p.moved_eui AND created_at < p.fridge_end;
  IF n = 0 THEN
    RAISE EXCEPTION 'Moved device % has no readings before fridge_end — already swapped?', p.moved_eui;
  END IF;
  SELECT count(*) INTO n FROM public.cw_air_data WHERE dev_eui = p.retired_eui AND created_at < p.container_swap;
  IF n = 0 THEN
    RAISE EXCEPTION 'Retired device % has no readings before container_swap — already swapped?', p.retired_eui;
  END IF;

  -- removing the transit readings must not cascade anywhere
  SELECT count(*) INTO n FROM public.cw_air_annotations
   WHERE dev_eui = p.moved_eui AND created_at >= p.fridge_end AND created_at < p.container_swap;
  IF n > 0 THEN
    RAISE EXCEPTION '% note(s) sit on the transit readings — deleting those would delete the notes; decide by hand', n;
  END IF;
  SELECT count(*) INTO n FROM public.cw_air_alerts WHERE dev_eui IN (p.moved_eui, p.retired_eui, p.fridge_eui);
  IF n > 0 THEN
    RAISE EXCEPTION '% cw_air_alerts row(s) exist for these devices — not expected; decide by hand', n;
  END IF;

  -- alarms and reports ------------------------------------------------------------
  -- The retired sensor becomes a tombstone: everything it still carries must be something this
  -- script moves, or it would be left behind on a device nobody looks at.
  SELECT array_agg(template_id ORDER BY template_id) INTO ids
    FROM public.cw_device_rule_assignments WHERE dev_eui = p.retired_eui AND NOT template_id = ANY (p.container_rules);
  IF ids IS NOT NULL THEN
    RAISE EXCEPTION 'Retired device % has rule template(s) % besides the container alarms % — move or remove them in the UI first',
      p.retired_eui, ids, p.container_rules;
  END IF;
  SELECT array_agg(template_id ORDER BY template_id) INTO ids
    FROM public.cw_rule_state WHERE dev_eui = p.retired_eui AND NOT template_id = ANY (p.container_rules);
  IF ids IS NOT NULL THEN
    RAISE EXCEPTION 'Retired device % has rule state for template(s) % besides the container alarms — decide by hand', p.retired_eui, ids;
  END IF;
  SELECT array_agg(template_id ORDER BY template_id) INTO ids
    FROM public.cw_device_report_assignments WHERE dev_eui = p.retired_eui AND NOT template_id = ANY (p.container_reports);
  IF ids IS NOT NULL THEN
    RAISE EXCEPTION 'Retired device % has report template(s) % besides the container report % — move or remove them in the UI first',
      p.retired_eui, ids, p.container_reports;
  END IF;
  -- The moved sensor's fridge-era log rows must not collide with the fridge sensor's own
  -- (UNIQUE (dev_eui, template_id, triggered_at)), nor the container's with the moved sensor's.
  SELECT count(*) INTO n
    FROM public.cw_rule_trigger_log m
   WHERE m.dev_eui = p.moved_eui AND m.triggered_at < p.fridge_end
     AND EXISTS (SELECT 1 FROM public.cw_rule_trigger_log f
                  WHERE f.dev_eui = p.fridge_eui AND f.template_id = m.template_id AND f.triggered_at = m.triggered_at);
  IF n > 0 THEN
    RAISE EXCEPTION '% fridge-era trigger log row(s) collide with rows the fridge sensor already has — decide by hand', n;
  END IF;
  SELECT count(*) INTO n
    FROM public.cw_rule_trigger_log r
   WHERE r.dev_eui = p.retired_eui
     AND EXISTS (SELECT 1 FROM public.cw_rule_trigger_log m
                  WHERE m.dev_eui = p.moved_eui AND m.template_id = r.template_id AND m.triggered_at = r.triggered_at);
  IF n > 0 THEN
    RAISE EXCEPTION '% container trigger log row(s) collide with rows the moved sensor already has — decide by hand', n;
  END IF;
  SELECT count(*) INTO n FROM public.cw_rule_monthly_usage WHERE dev_eui IN (p.moved_eui, p.retired_eui);
  IF n > 0 THEN
    RAISE EXCEPTION '% cw_rule_monthly_usage row(s) exist for the two old sensors — not expected; decide by hand', n;
  END IF;
  SELECT count(*) INTO n FROM public.cw_report_regeneration_queue
   WHERE dev_eui IN (p.moved_eui, p.retired_eui, p.fridge_eui) AND status IN ('pending', 'processing');
  IF n > 0 THEN
    RAISE EXCEPTION '% report regeneration(s) are queued for these devices — wait for them to finish', n;
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

CREATE TABLE maintenance.devswap_0171_780c_0110__cw_devices AS
  SELECT d.* FROM public.cw_devices d, _swap s WHERE d.dev_eui IN (s.moved_eui, s.retired_eui, s.fridge_eui);

CREATE TABLE maintenance.devswap_0171_780c_0110__cw_device_owners AS
  SELECT x.* FROM public.cw_device_owners x, _swap s WHERE x.dev_eui IN (s.moved_eui, s.retired_eui);

CREATE TABLE maintenance.devswap_0171_780c_0110__cw_device_rule_assignments AS
  SELECT x.* FROM public.cw_device_rule_assignments x, _swap s WHERE x.dev_eui IN (s.moved_eui, s.retired_eui);

CREATE TABLE maintenance.devswap_0171_780c_0110__cw_rule_state AS
  SELECT x.* FROM public.cw_rule_state x, _swap s WHERE x.dev_eui IN (s.moved_eui, s.retired_eui);

CREATE TABLE maintenance.devswap_0171_780c_0110__cw_rule_trigger_log AS
  SELECT x.* FROM public.cw_rule_trigger_log x, _swap s WHERE x.dev_eui IN (s.moved_eui, s.retired_eui);

CREATE TABLE maintenance.devswap_0171_780c_0110__cw_device_report_assignments AS
  SELECT x.* FROM public.cw_device_report_assignments x, _swap s WHERE x.dev_eui IN (s.moved_eui, s.retired_eui);

-- Rows that are NOT moved because the receiving sensor already has the same template: the
-- receiving row (and its state) wins, these are deleted. Empty in the surveyed state.
CREATE TABLE maintenance.devswap_0171_780c_0110__dropped AS
  SELECT 'cw_device_rule_assignments'::text AS tbl, r.id
    FROM public.cw_device_rule_assignments r, _swap s
   WHERE r.dev_eui = s.retired_eui AND r.template_id = ANY (s.container_rules)
     AND EXISTS (SELECT 1 FROM public.cw_device_rule_assignments m WHERE m.dev_eui = s.moved_eui AND m.template_id = r.template_id)
  UNION ALL
  SELECT 'cw_rule_state', r.id
    FROM public.cw_rule_state r, _swap s
   WHERE r.dev_eui = s.retired_eui AND r.template_id = ANY (s.container_rules)
     AND EXISTS (SELECT 1 FROM public.cw_rule_state m WHERE m.dev_eui = s.moved_eui AND m.template_id = r.template_id)
  UNION ALL
  SELECT 'cw_device_report_assignments', r.id
    FROM public.cw_device_report_assignments r, _swap s
   WHERE r.dev_eui = s.moved_eui AND r.template_id = ANY (s.fridge_reports)
     AND EXISTS (SELECT 1 FROM public.cw_device_report_assignments f WHERE f.dev_eui = s.fridge_eui AND f.template_id = r.template_id)
  UNION ALL
  SELECT 'cw_device_report_assignments', r.id
    FROM public.cw_device_report_assignments r, _swap s
   WHERE r.dev_eui = s.retired_eui AND r.template_id = ANY (s.container_reports)
     AND EXISTS (SELECT 1 FROM public.cw_device_report_assignments m WHERE m.dev_eui = s.moved_eui AND m.template_id = r.template_id);

-- The fridge sensor's own alarm and report assignments, to prove section 9 that they were not
-- touched (not a backup: nothing here changes them, and the rollback leaves them alone).
CREATE TEMP TABLE _fridge_before ON COMMIT DROP AS
  SELECT 'rule'::text AS k, x.id, x.template_id FROM public.cw_device_rule_assignments x, _swap s WHERE x.dev_eui = s.fridge_eui
  UNION ALL
  SELECT 'report', x.id, x.template_id FROM public.cw_device_report_assignments x, _swap s WHERE x.dev_eui = s.fridge_eui;

CREATE TABLE maintenance.devswap_0171_780c_0110__cw_air_annotations AS
  SELECT x.* FROM public.cw_air_annotations x, _swap s WHERE x.dev_eui IN (s.moved_eui, s.retired_eui);

CREATE TABLE maintenance.devswap_0171_780c_0110__cw_device_activity_hourly AS
  SELECT x.* FROM public.cw_device_activity_hourly x, _swap s WHERE x.dev_eui IN (s.moved_eui, s.retired_eui, s.fridge_eui);

-- The moved readings are only re-keyed, never altered, so the key list is a complete record of
-- what moved where (the rollback uses it to move exactly these rows back).
CREATE TABLE maintenance.devswap_0171_780c_0110__cw_air_data_keys AS
  SELECT a.dev_eui::varchar AS from_eui, s.fridge_eui AS to_eui, a.created_at
    FROM public.cw_air_data a, _swap s
   WHERE a.dev_eui = s.moved_eui AND a.created_at < s.fridge_end
  UNION ALL
  SELECT a.dev_eui::varchar, s.moved_eui, a.created_at
    FROM public.cw_air_data a, _swap s
   WHERE a.dev_eui = s.retired_eui AND a.created_at < s.container_swap;
-- the checks look slots up by both ends (shared minutes, see section 9)
CREATE INDEX ON maintenance.devswap_0171_780c_0110__cw_air_data_keys (from_eui, created_at);
CREATE INDEX ON maintenance.devswap_0171_780c_0110__cw_air_data_keys (to_eui, created_at);
ANALYZE maintenance.devswap_0171_780c_0110__cw_air_data_keys;

-- The transit readings are removed, so they are kept whole.
CREATE TABLE maintenance.devswap_0171_780c_0110__cw_air_data_removed AS
  SELECT a.* FROM public.cw_air_data a, _swap s
   WHERE a.dev_eui = s.moved_eui AND a.created_at >= s.fridge_end AND a.created_at < s.container_swap;

-- Fingerprint of every moved value, recomputed after the move (section 8).
CREATE TABLE maintenance.devswap_0171_780c_0110__cw_air_data_checksums AS
  SELECT k.from_eui, k.to_eui, count(*) AS n,
         md5(string_agg(row(a.created_at, a.temperature_c, a.humidity, a.co2, a.pressure, a.co, a.battery_level,
                            a.is_simulated, a.rainfall, a.wind_speed, a.wind_direction, a.lux, a.uv_index)::text,
                        '|' ORDER BY a.created_at)) AS md5
    FROM maintenance.devswap_0171_780c_0110__cw_air_data_keys k
    JOIN public.cw_air_data a ON a.dev_eui = k.from_eui AND a.created_at = k.created_at
   GROUP BY k.from_eui, k.to_eui;

CREATE TABLE maintenance.devswap_0171_780c_0110__log AS
  SELECT now()               AS ran_at,
         current_user::text  AS ran_by,
         s.moved_eui, s.retired_eui, s.fridge_eui, s.fridge_end, s.container_swap
    FROM _swap s;

-- -----------------------------------------------------------------------------
-- 3. READINGS
--    Order matters for the primary key (dev_eui, created_at): moved_eui must be empty before
--    container_swap (transit removed, fridge part re-keyed) before the container part arrives.
--    cw_air_annotations follow their reading through the ON UPDATE CASCADE foreign key.
-- -----------------------------------------------------------------------------
DELETE FROM public.cw_air_data a
 USING _swap s
 WHERE a.dev_eui = s.moved_eui AND a.created_at >= s.fridge_end AND a.created_at < s.container_swap;

UPDATE public.cw_air_data a
   SET dev_eui = s.fridge_eui
  FROM _swap s
 WHERE a.dev_eui = s.moved_eui AND a.created_at < s.fridge_end;

UPDATE public.cw_air_data a
   SET dev_eui = s.moved_eui
  FROM _swap s
 WHERE a.dev_eui = s.retired_eui AND a.created_at < s.container_swap;

-- -----------------------------------------------------------------------------
-- 4. ALARMS
--    Fridge: the alarms already run on fridge_eui (moved there in the UI); only their history
--    follows — the moved sensor's log rows from before fridge_end. Its 3 rows from AFTER
--    fridge_end (the 09:58 trigger when the sensor came out, a container warm spell at 20:18)
--    were caused by the sensor outside the fridge and stay with it.
--    Container: assignment, state and the whole log move retired -> moved; state unchanged
--    (see the header). Templates are not touched.
-- -----------------------------------------------------------------------------
UPDATE public.cw_rule_trigger_log x SET dev_eui = s.fridge_eui FROM _swap s
 WHERE x.dev_eui = s.moved_eui AND x.triggered_at < s.fridge_end;

UPDATE public.cw_device_rule_assignments x SET dev_eui = s.moved_eui FROM _swap s
 WHERE x.dev_eui = s.retired_eui AND x.template_id = ANY (s.container_rules)
   AND x.id NOT IN (SELECT id FROM maintenance.devswap_0171_780c_0110__dropped WHERE tbl = 'cw_device_rule_assignments');
UPDATE public.cw_rule_state x SET dev_eui = s.moved_eui FROM _swap s
 WHERE x.dev_eui = s.retired_eui AND x.template_id = ANY (s.container_rules)
   AND x.id NOT IN (SELECT id FROM maintenance.devswap_0171_780c_0110__dropped WHERE tbl = 'cw_rule_state');
DELETE FROM public.cw_device_rule_assignments x USING maintenance.devswap_0171_780c_0110__dropped d
 WHERE d.tbl = 'cw_device_rule_assignments' AND x.id = d.id;
DELETE FROM public.cw_rule_state x USING maintenance.devswap_0171_780c_0110__dropped d
 WHERE d.tbl = 'cw_rule_state' AND x.id = d.id;

UPDATE public.cw_rule_trigger_log x SET dev_eui = s.moved_eui FROM _swap s WHERE x.dev_eui = s.retired_eui;

-- -----------------------------------------------------------------------------
-- 5. WEEKLY REPORTS — 工場冷蔵庫 moved -> fridge, then 冷凍コンテナ③ retired -> moved
-- -----------------------------------------------------------------------------
UPDATE public.cw_device_report_assignments x SET dev_eui = s.fridge_eui FROM _swap s
 WHERE x.dev_eui = s.moved_eui AND x.template_id = ANY (s.fridge_reports)
   AND x.id NOT IN (SELECT id FROM maintenance.devswap_0171_780c_0110__dropped WHERE tbl = 'cw_device_report_assignments');
UPDATE public.cw_device_report_assignments x SET dev_eui = s.moved_eui FROM _swap s
 WHERE x.dev_eui = s.retired_eui AND x.template_id = ANY (s.container_reports)
   AND x.id NOT IN (SELECT id FROM maintenance.devswap_0171_780c_0110__dropped WHERE tbl = 'cw_device_report_assignments');
DELETE FROM public.cw_device_report_assignments x USING maintenance.devswap_0171_780c_0110__dropped d
 WHERE d.tbl = 'cw_device_report_assignments' AND x.id = d.id;

-- -----------------------------------------------------------------------------
-- 6. USER PERMISSIONS  (UNIQUE (dev_eui, user_id))
--    The container's permissions move onto its new sensor. Where the moved sensor already has
--    a row for a user (the Disabled rows the location move created), the level that user had on
--    the container's old sensor wins — that is what the customer has been working with.
--    343634315F33780C is left alone (see the header).
-- -----------------------------------------------------------------------------
UPDATE public.cw_device_owners m
   SET permission_level = r.permission_level
  FROM public.cw_device_owners r, _swap s
 WHERE m.dev_eui = s.moved_eui
   AND r.dev_eui = s.retired_eui
   AND m.user_id = r.user_id;

DELETE FROM public.cw_device_owners r
 USING _swap s
 WHERE r.dev_eui = s.retired_eui
   AND EXISTS (SELECT 1 FROM public.cw_device_owners m WHERE m.dev_eui = s.moved_eui AND m.user_id = r.user_id);

UPDATE public.cw_device_owners r SET dev_eui = s.moved_eui FROM _swap s WHERE r.dev_eui = s.retired_eui;

-- -----------------------------------------------------------------------------
-- 7. DEVICE ROWS
--    The retired sensor becomes a labelled tombstone (nobody but its owner sees it: all its
--    permission rows moved). The fridge sensor gets the old fridge sensor's group if it has
--    none. Names and locations of the two live sensors are already right.
-- -----------------------------------------------------------------------------
UPDATE public.cw_devices d
   SET name = d.name || '（交換済 → ' || s.moved_eui || '）'
  FROM _swap s
 WHERE d.dev_eui = s.retired_eui;

UPDATE public.cw_devices f
   SET "group" = m."group"
  FROM _swap s
  JOIN public.cw_devices m ON m.dev_eui = s.moved_eui
 WHERE f.dev_eui = s.fridge_eui
   AND f."group" IS NULL;

-- -----------------------------------------------------------------------------
-- 8. OVERVIEW UPLINK COUNTS — recount the three EUIs over the window the table holds, from the
--    same sources as cw_device_activity_recompute (which only upserts, so it would leave the
--    moved hours behind on the old EUI).
-- -----------------------------------------------------------------------------
DO $act$
DECLARE
  p       record;
  v_from  timestamptz;
BEGIN
  SELECT * INTO STRICT p FROM _swap;
  SELECT COALESCE(min(hour), date_trunc('hour', now()) - interval '35 days') INTO v_from
    FROM public.cw_device_activity_hourly;

  DELETE FROM public.cw_device_activity_hourly WHERE dev_eui IN (p.moved_eui, p.retired_eui, p.fridge_eui);

  INSERT INTO public.cw_device_activity_hourly (dev_eui, hour, uplinks)
  SELECT c.dev_eui, c.hour, sum(c.n)::integer
    FROM (
      SELECT dev_eui::text AS dev_eui, date_trunc('hour', created_at) AS hour, count(*) AS n
        FROM public.cw_air_data
       WHERE dev_eui IN (p.moved_eui, p.retired_eui, p.fridge_eui) AND created_at >= v_from
       GROUP BY 1, 2
      UNION ALL
      SELECT dev_eui::text, date_trunc('hour', created_at), count(*)
        FROM public.cw_soil_data
       WHERE dev_eui IN (p.moved_eui, p.retired_eui, p.fridge_eui) AND created_at >= v_from
       GROUP BY 1, 2
      UNION ALL
      SELECT dev_eui::text, date_trunc('hour', created_at), count(*)
        FROM public.cw_water_data
       WHERE dev_eui IN (p.moved_eui, p.retired_eui, p.fridge_eui) AND created_at >= v_from
       GROUP BY 1, 2
      UNION ALL
      SELECT dev_eui, date_trunc('hour', reported_at), count(*)
        FROM public.cw_relay_reports
       WHERE dev_eui IN (p.moved_eui, p.retired_eui, p.fridge_eui) AND reported_at >= v_from
       GROUP BY 1, 2
      UNION ALL
      SELECT dev_eui::text, traffic_hour, count(*)
        FROM public.cw_traffic2
       WHERE dev_eui IN (p.moved_eui, p.retired_eui, p.fridge_eui) AND traffic_hour >= v_from
       GROUP BY 1, 2
    ) c
   GROUP BY c.dev_eui, c.hour;
END
$act$;

-- -----------------------------------------------------------------------------
-- 9. VERIFY — any mismatch raises and rolls the whole transaction back
-- -----------------------------------------------------------------------------
DO $chk$
DECLARE
  p        record;
  c        record;
  n        bigint;
  n_fr     bigint;
  n_ct     bigint;
  summary  text;
BEGIN
  SELECT * INTO STRICT p FROM _swap;

  -- readings: every backed-up key is under its new EUI and no longer under its old one. The two
  -- old sensors share 1,182 whole-minute timestamps, so the moved sensor's old slot may rightly
  -- hold the container reading that arrived from the retired sensor at the same minute.
  SELECT count(*) INTO n
    FROM maintenance.devswap_0171_780c_0110__cw_air_data_keys k
   WHERE NOT EXISTS (SELECT 1 FROM public.cw_air_data a WHERE a.dev_eui = k.to_eui AND a.created_at = k.created_at)
      OR (EXISTS     (SELECT 1 FROM public.cw_air_data a WHERE a.dev_eui = k.from_eui AND a.created_at = k.created_at)
          AND NOT EXISTS (SELECT 1 FROM maintenance.devswap_0171_780c_0110__cw_air_data_keys k2
                           WHERE k2.to_eui = k.from_eui AND k2.created_at = k.created_at));
  IF n <> 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: % moved reading(s) are not exactly where they should be', n;
  END IF;

  -- ... with every value unchanged
  FOR c IN SELECT * FROM maintenance.devswap_0171_780c_0110__cw_air_data_checksums LOOP
    IF (SELECT md5(string_agg(row(a.created_at, a.temperature_c, a.humidity, a.co2, a.pressure, a.co, a.battery_level,
                                  a.is_simulated, a.rainfall, a.wind_speed, a.wind_direction, a.lux, a.uv_index)::text,
                              '|' ORDER BY a.created_at))
          FROM maintenance.devswap_0171_780c_0110__cw_air_data_keys k
          JOIN public.cw_air_data a ON a.dev_eui = k.to_eui AND a.created_at = k.created_at
         WHERE k.from_eui = c.from_eui) IS DISTINCT FROM c.md5 THEN
      RAISE EXCEPTION 'VERIFY FAILED: the readings moved % -> % do not match their checksum', c.from_eui, c.to_eui;
    END IF;
  END LOOP;

  -- ... and each EUI holds nothing else before its cut-over
  SELECT count(*) INTO n FROM public.cw_air_data WHERE dev_eui = p.fridge_eui AND created_at < p.fridge_end;
  SELECT count(*) INTO n_fr FROM maintenance.devswap_0171_780c_0110__cw_air_data_keys WHERE to_eui = p.fridge_eui;
  IF n <> n_fr THEN
    RAISE EXCEPTION 'VERIFY FAILED: % has % reading(s) before fridge_end, expected %', p.fridge_eui, n, n_fr;
  END IF;
  SELECT count(*) INTO n FROM public.cw_air_data WHERE dev_eui = p.moved_eui AND created_at < p.container_swap;
  SELECT count(*) INTO n_ct FROM maintenance.devswap_0171_780c_0110__cw_air_data_keys WHERE to_eui = p.moved_eui;
  IF n <> n_ct THEN
    RAISE EXCEPTION 'VERIFY FAILED: % has % reading(s) before container_swap, expected %', p.moved_eui, n, n_ct;
  END IF;
  SELECT count(*) INTO n FROM public.cw_air_data WHERE dev_eui = p.retired_eui AND created_at < p.container_swap;
  IF n <> 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: % still has % reading(s) before container_swap', p.retired_eui, n;
  END IF;
  SELECT count(*) INTO n FROM maintenance.devswap_0171_780c_0110__cw_air_data_removed;
  IF n <> p.expected_transit THEN
    RAISE EXCEPTION 'VERIFY FAILED: % transit reading(s) backed up, expected %', n, p.expected_transit;
  END IF;

  -- notes: every one still exists, on the EUI its reading moved to
  SELECT count(*) INTO n
    FROM maintenance.devswap_0171_780c_0110__cw_air_annotations b
   WHERE NOT EXISTS (
         SELECT 1 FROM public.cw_air_annotations x
          WHERE x.id = b.id AND x.created_at = b.created_at
            AND x.title = b.title AND x.note IS NOT DISTINCT FROM b.note
            AND x.dev_eui = CASE
                  WHEN b.dev_eui = p.moved_eui   AND b.created_at < p.fridge_end     THEN p.fridge_eui
                  WHEN b.dev_eui = p.retired_eui AND b.created_at < p.container_swap THEN p.moved_eui
                  ELSE b.dev_eui END);
  IF n <> 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: % note(s) did not follow their reading', n;
  END IF;

  -- alarms: the moved sensor has every container alarm either sensor had, the retired one none,
  -- the moved sensor's own assignments are untouched, the fridge sensor's are exactly as before
  SELECT count(*) INTO n
    FROM (SELECT DISTINCT template_id FROM maintenance.devswap_0171_780c_0110__cw_device_rule_assignments
           WHERE template_id = ANY (p.container_rules)) t
   WHERE NOT EXISTS (SELECT 1 FROM public.cw_device_rule_assignments x WHERE x.dev_eui = p.moved_eui AND x.template_id = t.template_id);
  IF n <> 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: % container alarm(s) are not on the moved sensor', n;
  END IF;
  SELECT count(*) INTO n FROM public.cw_device_rule_assignments WHERE dev_eui = p.retired_eui;
  IF n <> 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: the retired sensor still has % rule assignment(s)', n;
  END IF;
  SELECT count(*) INTO n
    FROM maintenance.devswap_0171_780c_0110__cw_device_rule_assignments b
   WHERE b.dev_eui = p.moved_eui
     AND NOT EXISTS (SELECT 1 FROM public.cw_device_rule_assignments x WHERE x.id = b.id AND x.dev_eui = p.moved_eui);
  IF n <> 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: % of the moved sensor''s own rule assignment(s) changed', n;
  END IF;
  IF EXISTS (SELECT f.id, f.template_id FROM _fridge_before f WHERE f.k = 'rule'
             EXCEPT
             SELECT x.id, x.template_id FROM public.cw_device_rule_assignments x WHERE x.dev_eui = p.fridge_eui)
  OR EXISTS (SELECT x.id, x.template_id FROM public.cw_device_rule_assignments x WHERE x.dev_eui = p.fridge_eui
             EXCEPT
             SELECT f.id, f.template_id FROM _fridge_before f WHERE f.k = 'rule') THEN
    RAISE EXCEPTION 'VERIFY FAILED: the fridge sensor''s alarm assignments changed';
  END IF;
  -- the container's rule state moved bit-for-bit (in particular is_triggered), unless it was
  -- dropped in favour of the moved sensor's own; the moved sensor's own state rows stay on it
  SELECT count(*) INTO n
    FROM maintenance.devswap_0171_780c_0110__cw_rule_state b
   WHERE b.dev_eui = p.retired_eui
     AND b.id NOT IN (SELECT id FROM maintenance.devswap_0171_780c_0110__dropped WHERE tbl = 'cw_rule_state')
     AND NOT EXISTS (
         SELECT 1 FROM public.cw_rule_state x
          WHERE x.id = b.id AND x.dev_eui = p.moved_eui AND x.template_id = b.template_id
            AND x.is_triggered = b.is_triggered
            AND x.last_triggered_at IS NOT DISTINCT FROM b.last_triggered_at
            AND x.last_reset_at     IS NOT DISTINCT FROM b.last_reset_at);
  IF n <> 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: % container rule state row(s) did not carry over unchanged', n;
  END IF;
  SELECT count(*) INTO n
    FROM maintenance.devswap_0171_780c_0110__cw_rule_state b
   WHERE (b.dev_eui = p.moved_eui AND NOT EXISTS (SELECT 1 FROM public.cw_rule_state x WHERE x.id = b.id AND x.dev_eui = p.moved_eui))
      OR (b.id IN (SELECT id FROM maintenance.devswap_0171_780c_0110__dropped WHERE tbl = 'cw_rule_state')
          AND EXISTS (SELECT 1 FROM public.cw_rule_state x WHERE x.id = b.id));
  IF n <> 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: % rule state row(s) of the moved sensor were lost, or dropped rows survived', n;
  END IF;
  SELECT count(*) INTO n FROM public.cw_rule_state WHERE dev_eui = p.retired_eui;
  IF n <> 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: the retired sensor still has % rule state row(s)', n;
  END IF;
  SELECT count(*) INTO n
    FROM maintenance.devswap_0171_780c_0110__cw_rule_trigger_log b
   WHERE NOT EXISTS (
         SELECT 1 FROM public.cw_rule_trigger_log x
          WHERE x.id = b.id AND x.template_id = b.template_id
            AND x.triggered_at IS NOT DISTINCT FROM b.triggered_at
            -- moved rows from before fridge_end went to the fridge; the rest of moved's stayed,
            -- and all of retired's came to moved
            AND x.dev_eui = CASE WHEN b.dev_eui = p.moved_eui AND b.triggered_at < p.fridge_end
                                 THEN p.fridge_eui ELSE p.moved_eui END);
  IF n <> 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: % trigger log row(s) are not where they should be', n;
  END IF;
  -- reports: 工場冷蔵庫 on the fridge sensor (if either had it) and not on the moved one;
  -- 冷凍コンテナ③ on the moved sensor (if either had it) and not on the retired one; the fridge
  -- sensor's other report assignments untouched
  SELECT count(*) INTO n
    FROM (SELECT template_id FROM maintenance.devswap_0171_780c_0110__cw_device_report_assignments
           WHERE dev_eui = p.moved_eui AND template_id = ANY (p.fridge_reports)
          UNION
          SELECT template_id FROM _fridge_before WHERE k = 'report' AND template_id = ANY (p.fridge_reports)) t
   WHERE NOT EXISTS (SELECT 1 FROM public.cw_device_report_assignments x WHERE x.dev_eui = p.fridge_eui AND x.template_id = t.template_id);
  IF n <> 0
  OR EXISTS (SELECT 1 FROM public.cw_device_report_assignments WHERE dev_eui = p.moved_eui AND template_id = ANY (p.fridge_reports)) THEN
    RAISE EXCEPTION 'VERIFY FAILED: the 工場冷蔵庫 report is not (only) on the fridge sensor';
  END IF;
  SELECT count(*) INTO n
    FROM (SELECT DISTINCT template_id FROM maintenance.devswap_0171_780c_0110__cw_device_report_assignments
           WHERE template_id = ANY (p.container_reports)) t
   WHERE NOT EXISTS (SELECT 1 FROM public.cw_device_report_assignments x WHERE x.dev_eui = p.moved_eui AND x.template_id = t.template_id);
  IF n <> 0
  OR EXISTS (SELECT 1 FROM public.cw_device_report_assignments WHERE dev_eui = p.retired_eui) THEN
    RAISE EXCEPTION 'VERIFY FAILED: the 冷凍コンテナ③ report is not (only) on the moved sensor';
  END IF;
  IF EXISTS (SELECT f.id FROM _fridge_before f WHERE f.k = 'report'
             EXCEPT
             SELECT x.id FROM public.cw_device_report_assignments x WHERE x.dev_eui = p.fridge_eui) THEN
    RAISE EXCEPTION 'VERIFY FAILED: the fridge sensor lost a report assignment it had';
  END IF;

  -- permissions: every container user has exactly their container level on the moved sensor,
  -- users who only had a row on the moved sensor keep theirs, the retired sensor has none
  SELECT count(*) INTO n
    FROM maintenance.devswap_0171_780c_0110__cw_device_owners b
   WHERE b.dev_eui = p.retired_eui
     AND NOT EXISTS (SELECT 1 FROM public.cw_device_owners o
                      WHERE o.dev_eui = p.moved_eui AND o.user_id = b.user_id AND o.permission_level = b.permission_level);
  IF n <> 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: % container permission(s) did not carry over unchanged', n;
  END IF;
  SELECT count(*) INTO n
    FROM maintenance.devswap_0171_780c_0110__cw_device_owners b
   WHERE b.dev_eui = p.moved_eui
     AND NOT EXISTS (SELECT 1 FROM maintenance.devswap_0171_780c_0110__cw_device_owners r
                      WHERE r.dev_eui = p.retired_eui AND r.user_id = b.user_id)
     AND NOT EXISTS (SELECT 1 FROM public.cw_device_owners o
                      WHERE o.id = b.id AND o.dev_eui = p.moved_eui AND o.permission_level = b.permission_level);
  IF n <> 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: % permission(s) of users without a container row changed', n;
  END IF;
  SELECT count(*) INTO n FROM public.cw_device_owners WHERE dev_eui = p.retired_eui;
  IF n <> 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: the retired sensor still has % permission row(s)', n;
  END IF;

  -- device rows
  PERFORM 1 FROM public.cw_devices WHERE dev_eui = p.retired_eui AND name = '冷凍コンテナ③（交換済 → ' || p.moved_eui || '）';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'VERIFY FAILED: the retired sensor was not renamed to its tombstone name';
  END IF;

  SELECT count(*) INTO n FROM maintenance.devswap_0171_780c_0110__dropped;
  summary := format('readings %s -> %s: %s, %s -> %s: %s, transit removed: %s, duplicate alarm/report rows dropped: %s',
                    p.moved_eui, p.fridge_eui, n_fr, p.retired_eui, p.moved_eui, n_ct, p.expected_transit, n);
  RAISE NOTICE 'All checks passed. %', summary;

  IF p.dry_run THEN
    RAISE EXCEPTION 'DRY RUN OK — every check passed and NOTHING was changed (rolled back on purpose). Would do: %  >>> set dry_run = FALSE to apply.', summary;
  END IF;
END
$chk$;

COMMIT;

-- -----------------------------------------------------------------------------
-- 10. RESULT (only reached when applied). Expect, at the time of writing:
--     343634315F33780C  工場冷蔵庫   history from 2024-08-02, rules 21+22 (as the UI set them),
--                       trigger log 43 + its own, report 1
--     2CF7F1C061700171  冷凍コンテナ3 history from 2025-01-05, rules 17+19 (triggered until
--                       its next reading <= -15 C), report 4, 7 permission rows
--     2CF7F1C053000110  tombstone, 5 readings, nothing else
-- -----------------------------------------------------------------------------
SELECT d.dev_eui,
       d.name,
       d.location_id,
       (SELECT min(created_at) FROM public.cw_air_data a WHERE a.dev_eui = d.dev_eui)                   AS first_reading,
       (SELECT count(*) FROM public.cw_air_data a WHERE a.dev_eui = d.dev_eui)                          AS readings,
       (SELECT array_agg(template_id ORDER BY template_id) FROM public.cw_device_rule_assignments r
         WHERE r.dev_eui = d.dev_eui)                                                                   AS rule_templates,
       (SELECT bool_or(is_triggered) FROM public.cw_rule_state s WHERE s.dev_eui = d.dev_eui)           AS rule_triggered,
       (SELECT count(*) FROM public.cw_rule_trigger_log g WHERE g.dev_eui = d.dev_eui)                  AS trigger_log_rows,
       (SELECT array_agg(template_id ORDER BY template_id) FROM public.cw_device_report_assignments r
         WHERE r.dev_eui = d.dev_eui)                                                                   AS report_templates,
       (SELECT count(*) FROM public.cw_device_owners o WHERE o.dev_eui = d.dev_eui)                     AS permission_rows
  FROM public.cw_devices d
 WHERE d.dev_eui IN ('343634315F33780C', '2CF7F1C061700171', '2CF7F1C053000110')
 ORDER BY d.location_id, d.dev_eui;
