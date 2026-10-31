# Sensor swap 2026-10-28: 冷凍コンテナ3 and 工場冷蔵庫 (TK-Ebisu)

On 2026-10-28 three sensors changed places:

- `2CF7F1C061700171` (S2101) had been the factory fridge's sensor (工場冷蔵庫, location 59) since
  2024-08-02. It left the fridge at about 09:50 JST and went into freezer container 冷凍コンテナ3
  (location 82) at about 11:10 JST,
- replacing `2CF7F1C053000110` (S2103), the container's sensor since 2025-01-05, which is retired.
- `343634315F33780C` (CropWatch air T/H) is the fridge's new sensor and has reported since 21:05 JST.

The device rows were already updated in the UI (names, locations). On 10-29 between 16:55 and
17:05 JST the alarms were edited in the UI too:

- The fridge alarms 21 冷蔵庫温度警報（10℃以上） and 22 冷蔵庫温度注意（5℃以上） now run on
  `343634315F33780C` (and on 原料冷蔵庫 `323833327F327415`). Both fired at 16:58 JST (11.23 °C).
  `…0171` has no alarms left, and the UI deleted its state rows for 21/22.
- The container alarms 17 冷凍庫温度注意（-10℃以上） and 19 冷凍庫温度警報（0℃以上） were re-saved
  **still on the retired `…0110`** (plus `…0124`, `…0183` and 原料冷凍庫 `323833324F327E04`). Until
  `01` runs, nothing watches 冷凍コンテナ3's real sensor.

The history, the container's alarms, the reports and the permissions had not followed. After `01`
each EUI carries the history of the place it now measures:

| EUI | Place | History | Alarms | Weekly report |
|---|---|---|---|---|
| `343634315F33780C` | 工場冷蔵庫 | `…0171`'s fridge readings 2024-08-02 → 10-28 09:48, then its own from 21:05 | 21, 22, as the UI set them (untouched); their log gains the 43 fridge-era rows | template 1 工場冷蔵庫 |
| `2CF7F1C061700171` | 冷凍コンテナ3 | `…0110`'s container readings 2025-01-05 → 10-28 11:04, then its own from 11:18 | 17, 19, with state and log | template 4 冷凍コンテナ③ |
| `2CF7F1C053000110` | — (tombstone) | its 5 readings from after it was pulled out | none | none |

If you add `…0171` to alarms 17/19, or the reports to their new sensors, in the UI before running
`01`, that works too. Wherever the receiving sensor already has a template, its row (and state) wins,
and the sending row is dropped. Dropped rows are kept in the backup, listed in `…_dropped`, and
restored by the rollback.

| File | What it does |
|---|---|
| `01_swap_sensors.sql` | The migration. **Dry-run by default.** |
| `UNDO_swap_sensors.sql` | Undo, from the backups `01` takes. Dry-run by default. |
| `02_move_report_pdfs.py` | Moves the 42 fridge PDFs to `343634315F33780C/`, then copies the 15 container PDFs to `2CF7F1C061700171/`. Dry-run by default; `--rollback` undoes it. |

## Where the cut-overs come from

From the readings, not the clock (JST):

| Time | `2CF7F1C061700171` | `2CF7F1C053000110` |
|---|---|---|
| 09:48 | +2.58 °C, 100 %RH: last reading in the fridge | −21.97 °C |
| 09:58 – 11:08 | +11 … +20 °C: in transit (8 readings) | −21.9 … −22.1 °C |
| 11:04 | | −22.12 °C: last reading in the container |
| 11:18 | +13.66 °C, **24 %RH**: in the freezer air | |
| 11:19 – 12:19 | −9 °C at 11:28, −19 °C by 14:00 | −1.75 °C, then +20 … +27 °C: pulled out, then silent |

`fridge_end = 09:50 JST`, `container_swap = 11:10 JST`. The 8 transit readings are **removed**
(kept whole in the backup; the rollback restores them). Under `…0171` they would interleave with the
moved container readings (`…0110` read −22 °C at :04/:19/:34/:49 in the same window) and put a fake
+20 °C excursion into the container's report. The fridge history has a gap from 09:50 to 21:05 JST
on 10-28 (no sensor was in it). The container has no gap.

## What changes

| Table | Rows | Note |
|---|---|---|
| `cw_air_data` | 130,650 `…0171` → `…780C`; 90,226 `…0110` → `…0171`; 8 removed | Re-keyed only, values checksum-verified. No FK to `cw_devices`, which is why the UI could not do this. |
| `cw_air_annotations` | 100 + 164 | Follow their reading (composite FK, `ON UPDATE CASCADE`). |
| `cw_device_rule_assignments`, `cw_rule_state` | 2, 2 | The container's 17/19 → `…0171`, state unchanged. The fridge's 21/22 rows on `…780C` are not touched. No template is changed. |
| `cw_rule_trigger_log` | 43 → `…780C`, 11 → `…0171` | Closed fridge-era rows land behind `…780C`'s 2 live ones. The fridge log's 3 rows from after 09:50 (the 09:58 alarm when the sensor came out, a 20:18 container warm spell) stay on `…0171`, where those readings are. |
| `cw_device_report_assignments` | 1 + 1 | Template 1 → `…780C`, template 4 → `…0171`. |
| `cw_device_owners` | 7 on `…0171` | The container's permissions: the levels from `…0110` replace the Disabled rows the location move left on `…0171`. |
| `cw_devices` | 2 | `…0110` renamed `冷凍コンテナ③（交換済 → 2CF7F1C061700171）`; `…780C` gets group TKエビス. |
| `cw_device_activity_hourly` | 3 EUIs | Recounted from the moved telemetry. |

**Not touched**, because they describe the radio, not the place: `cw_device_gateway`,
`cw_device_status(_events)`, `device_licenses`, `cw_soil_data` (`…780C` has 170 soil rows from
09-29 to 10-25, earlier testing, not shown for an air sensor). **`…780C`'s own permissions are not
touched either:** the old fridge permissions were deleted when `…0171` was moved to location 82 and
cannot be recovered. Its customers are at 5 = Disabled; set them in the UI.

## What happens the moment it commits

All four alarm actions are e-mail only and none has `revertOnReset`, so a reset sends nothing; only
a trigger does.

- **Container (17, 19):** from this moment they watch 冷凍コンテナ3's real sensor again. They are
  still triggered from the pull-out, so the next `…0171` reading ≤ −15 °C resets both silently and
  closes the two open log rows. After that they fire on this sensor's readings, and it reads warm
  spells much higher than the old one: **+6.95 °C at 20:18 JST on its first evening**, where
  `…0110`'s warmest reading in two weeks was −4.3 °C. Rule 19 (≥ 0 °C), which the old sensor almost
  never tripped, will probably start e-mailing. Check the sensor's placement or the thresholds.
- **Fridge (21, 22):** nothing changes. They already run on `…780C`.
- The container users who were Disabled on `…0171` see it on their next page load.

## Running it

**Before the weekly report run on Sun 2026-11-01 16:00 UTC (Mon 01:00 JST).** Otherwise the 10-25 …
10-31 reports are generated from the wrong sensors and have to be regenerated.

**It takes several minutes on production, with no progress shown. Do not cancel it.** The full run
on 10-29 that reached the verify step took ~3.5 min: pre-flight ~40 s, backups ~55 s, the two
UPDATEs ~40 s and ~30 s, then the checks. `cw_air_data` is 2.6 GB with its indexes, against 256 MB of
shared buffers, so most of this is disk reads.

**Vacuum before and after.** Every run that does the UPDATEs and then rolls back (a dry run, a
failed check, a cancel) leaves ~220k dead row versions. The first attempts on 10-29 left 1.68M
dead rows (autovacuum only starts at ~2.1M). They make every later run slower, and the app's queries
for these sensors too. A count of the fridge sensor's ~200 readings had to skip 270k dead index
entries and took 26 s. So, from a session that is **not** in a transaction (`ROLLBACK;` first in
DBeaver), before the swap and again after it commits:

```sql
VACUUM (ANALYZE) public.cw_air_data;   -- a few minutes; does not block reads or writes
```

**A production dry run is optional.** It costs as much as the real run, and leaves another ~220k
dead rows. The real run commits only after every check has passed; a failed check rolls it back
exactly like a dry run.

Only `01_swap_sensors.sql` and `02_move_report_pdfs.py` are run, in that order:

```sh
# 01 rehearsal: does everything, verifies, then aborts on purpose with "DRY RUN OK ..."
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 01_swap_sensors.sql
# 01 for real: in 01_swap_sensors.sql section 0, change  TRUE AS dry_run  to  FALSE AS dry_run,
#              then run the same command again; the last statement prints the result
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 01_swap_sensors.sql
# 02 report PDFs
export SUPABASE_URL=...  SUPABASE_SERVICE_ROLE_KEY=...
python3 02_move_report_pdfs.py            # plan: 42 moves, 15 copies
python3 02_move_report_pdfs.py --apply
```

`UNDO_swap_sensors.sql` is not a step. It reverses an applied `01`, and before that it refuses with
"No backup found".

**DBeaver:** run the file with *Execute SQL Script* (Alt+X), not *Execute statement* (Ctrl+Enter),
which runs only the statement under the cursor. A dry run ends as `SQL Error [P0001]: ERROR: DRY RUN
OK — …`, and so does any refused check. DBeaver stops there and leaves the editor's session in an
aborted transaction, which holds no locks. Both SQL files start with `ROLLBACK;`, so the next run in
the same editor clears that by itself (on a clean session it only warns "there is no transaction in
progress").

The Supabase SQL editor works too (paste the whole file). The dry run shows up as an error whose
message starts with `DRY RUN OK`. The swap re-keys ~221k readings in one transaction: allow a
minute, and prefer psql if the editor times out (a timeout rolls everything back). Any failed check
raises and rolls back everything. A lock timeout means a writer held a row at that instant; run it
again.

Between `01` and `02`, the report history in the UI shows the fridge's PDFs under 冷凍コンテナ3 and
none under 工場冷蔵庫. Run `02` straight after `01`.

## Afterwards (outside this folder)

- `…780C`: set the customers' permissions in the UI (today: all Disabled except sayaka).
- `…0110`: delete or disable it in TTS so it cannot uplink again. Then remove its tombstone like
  `../2026-09-19_replace_device_0025CA0000005722/04_delete_old_device.sql` did for the last swap.
- If the local Postgres twin keeps its own `cw_air_data`, its history is still under the old EUIs.

## Backups and rollback

`01` copies every row it touches into the private `maintenance` schema as
`devswap_0171_780c_0110__*`: device, permission, rule, state, log and report rows of the two old
sensors; the notes; the overview counts; the key list of every moved reading plus a checksum per set;
the 8 removed readings in full; and the list of dropped duplicates. `UNDO_swap_sensors.sql` uses them to
move exactly those readings back, restore the transit readings, move rules, state, log and reports
back by primary key, re-insert dropped duplicates, and restore the permission rows exactly. The
fridge sensor's own alarms are not touched in either direction. Values the alert engine changed after the swap are moved back as they are
now, and rows created after the swap stay where they are. `01` refuses to run while the backup
exists. Drop the tables by hand when you no longer need them.

## How this was tested

Rehearsed on a throwaway local PostgreSQL 16.2 (production is 17.4) built from the production
catalog: the touched tables with their columns, PK/UNIQUE/CHECK constraints, FKs, indexes, and the
`org_cap_guest_device_grant` trigger. It was seeded to mirror production after the UI alarm edits:
3.1M readings, the three sensors on the real time grid around the cut (130,594 / 8 / 63,445 / 5
readings in the four windows), the real rule, state, log, report and permission rows (same ids, incl.
the UI's re-created assignments 234–254 and the fridge's live triggered state 103/104), 264 notes, and
the four other devices sharing templates 17/19 or 21/22. Results:

- **Shared minutes.** The two old sensors both have a reading at 1,182 whole-minute timestamps
  (2026-09-07 … 10-27). At those minutes `…0171`'s slot is legitimately refilled by the container
  reading moved in from `…0110`. The first production run of `01` stopped at a check that took that
  for a reading left behind ("VERIFY FAILED: 1182 moved reading(s) …"). It rolled back completely.
  The checks in `01` and in the undo now allow for it. Rehearsed again with 7,243 shared minutes and
  notes on both readings of one: the old check reproduces the failure; the fixed ones pass, notes
  follow their readings, and the undo is byte-exact.
- `01` dry run: every public table byte-identical, no `maintenance` schema left behind.
- `01` real run: 12 s locally. Every expectation in the tables above held.
- `01` under a simulated ingest, with the alarm engine resetting the fridge's two alarms mid-run (a
  reading and a device-row update for both live sensors every ~30 ms throughout): no blocking, no
  errors, all checks passed. The alarm rows of every other device were identical before and after.
- `01` after 17/19 and both reports were also assigned to the new sensors in the UI, with rule 17
  already tripped on `…0171`: the UI's rows and state won, 5 duplicates were dropped, and `UNDO` restored
  the pre-run state byte-for-byte, dropped rows included.
- Second run of `01`: refused, nothing changed.
- Eleven unexpected states, each refused with nothing changed: a fridge reading before the cut; a 9th
  transit reading; a note on a transit reading; another alarm or report left on the retired sensor; a
  fridge log row colliding with the moved history; a monthly-usage row; a queued report
  regeneration; the retired row renamed; a `cw_air_alerts` row; the moved sensor in another location.
- `UNDO` dry run: every public table byte-identical.
- `UNDO` real run: **restored every public table byte-for-byte** to the pre-swap state. A second run
  was refused.
- `UNDO` after simulated post-swap activity (the engine resetting 17/19, rule 22 firing on the fridge
  sensor, a permission row added in the UI, ingest running): behaved as described above.
- `02` against a stub of the Storage API seeded with the real 57 file names and sizes: the plan,
  apply (contents identical, originals kept), re-run (0 steps), an apply interrupted after 20 calls
  and then resumed, rollback with post-swap PDFs present (kept), rollback re-run, and an
  unrecognised file name (refused).

**Nothing here has been run against production**, not even as a dry run. The survey was read-only,
through the Supabase MCP.
