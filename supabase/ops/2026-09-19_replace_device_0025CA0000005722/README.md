# Replace sensor 0025CA0000005722 with 3436343159337A10 (トンネルフリーザー1)

The RM1261-based sensor `0025CA0000005722` ("トンネルフリーザー1", location 155 凍結工程) died on
2026-09-10 and is decommissioned. `3436343159337A10` takes its place. After the change the new
EUI is "トンネルフリーザー1" and owns the full history, the user permissions, the alarm rule with
its state and log, and the weekly report.

| File | What it does |
|---|---|
| `01_replace_device.sql` | The migration. **Dry-run by default.** |
| `02_rollback.sql` | Undo, from the backups `01` takes. Dry-run by default. |
| `03_copy_report_pdfs.py` | Copies the 12 existing report PDFs to the new EUI's storage folder. Dry-run by default. |
| `04_delete_old_device.sql` | Clean-up: deletes the old sensor's tombstone row from `cw_devices`. Dry-run by default. |
| `05_delete_old_report_pdfs.py` | Clean-up (optional): deletes the original PDFs that have an identical copy under the new EUI. Dry-run by default. |

## Starting point (read-only survey, 2026-09-19 00:30 JST)

**The replacement is already registered and live.** `3436343159337A10` exists in `cw_devices` as
"JA Pipe Device" (type 2, no location, no group, **no owner rows**, no rules, no reports) and has
67 readings since 2026-09-18 03:48Z, one more every ~10 minutes. They are real freezer data —
about 14 °C until 13:59 JST, −18 … −33 °C from 14:20 while the tunnel ran, warming since 18:05 —
so they are **kept** and become the newest part of the freezer's history. The old history ends
2026-09-10, so the two do not overlap. So this is a *merge into an existing row*, not a rename.

## What changes

| Table | Rows | Note |
|---|---|---|
| `cw_devices` (new EUI) | 1 updated | name "JA Pipe Device" → "トンネルフリーザー1"; location NULL → 155; group NULL → JA. Its own sensor serials, `error_status` and live `last_data_updated_at` are left alone. |
| `cw_devices` (old EUI) | 1 renamed | tombstone, or deleted — see `old_device_action` |
| `cw_air_data` | 12,227 moved | 2026-06-08 17:28Z → 2026-09-10 22:50Z. Re-keyed only, values untouched. **No FK to `cw_devices`** — this is why the API's `replaceDevice` (rename + cascade) would leave the history behind; it would also hit the primary key, since the new row exists. |
| `cw_device_owners` | 5 moved | permission levels unchanged. The new device has none today, so this is what makes it visible to the customer. |
| `cw_device_rule_assignments` | 1 moved | template 9 トンネルフリーザー温度異常 (shared with トンネルフリーザー2 — the template is not touched) |
| `cw_rule_state` | 1 moved | **unchanged, `is_triggered = true`** — see below. No FK either. |
| `cw_rule_trigger_log` | 73 moved | |
| `cw_device_report_assignments` | 1 moved | template 15, weekly, 3 recipients |
| 12 other `dev_eui` tables | 0 | handled generically if rows appear before you run it |

A text search of every other table in `public` found no further reference to either EUI, and no
triggers exist on any of these tables.

## What happens the moment it commits

The sensor is live, so from its next uplink (≤ ~10 min) the alert engine evaluates rule 9 against
it and the 5 users see the device with its full history.

Rule 9 triggers at ≥ −20 °C and resets at ≤ −25 °C (2 LoRaWAN actions + e-mail). It cycles daily
with the tunnel (73 log entries) and is currently **triggered**: the last action it dispatched was
the trigger on 2026-09-10 08:17Z, and the old sensor died before the next reset. The state is moved
unchanged on purpose. While triggered, the alert engine never re-fires — it only waits for the
reset value — so whatever the sensor reads when this commits (≈ +11 °C at night with the tunnel
off) **nothing is dispatched**, and the engine stays consistent with the last action the customer's
relays actually received. The **reset** actions go out when the sensor next reads ≤ −25 °C (next
tunnel start) and the normal daily cycle resumes. Clearing the state instead would fire the e-mail
and both LoRaWAN actions on the very next warm reading.

The weekly report (end of week, UTC+9) will cover 09-18 onward from the new sensor; 09-11 … 09-17
has no data (the gap between the two sensors).

## Running it

```sh
# 1. rehearse — does everything, verifies, then aborts on purpose with "DRY RUN OK ..."
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 01_replace_device.sql
# 2. set  dry_run = FALSE  in section 0 and run it again; the last statement prints the result
```

The Supabase SQL editor works too (paste the whole file): the dry run shows up as an error whose
message starts with `DRY RUN OK`. Any failed check raises, which rolls back everything. If it
fails with a lock timeout, the ingest was writing the device row at that instant — just run it again.

`old_device_action` (section 0): `'rename'` (default) keeps the old row as a tombstone named
`トンネルフリーザー1（交換済 → 3436343159337A10）`. Customers do not see it — device visibility comes
from `cw_device_owners`, and all five rows move. `'delete'` removes the row (it is in the backup
either way).

## Afterwards

Copy the report PDFs so the report history stays visible in the UI (the API lists it with
`storage.list(<dev_eui>)`, and the files are under the old EUI's folder):

```sh
export SUPABASE_URL=...  SUPABASE_SERVICE_ROLE_KEY=...
python3 03_copy_report_pdfs.py            # dry run
python3 03_copy_report_pdfs.py --apply
```

The first eight readings of the new sensor (09-18 12:48–13:59 JST, ≈ 14 °C) predate the tunnel
start that day. They are kept; if they were taken somewhere other than this freezer, remove them
deliberately:

```sql
-- BEGIN;
-- DELETE FROM public.cw_air_data
--  WHERE dev_eui = '3436343159337A10'
--    AND created_at >= '2026-09-18 03:48:00+00' AND created_at < '2026-09-18 05:20:00+00';
-- -- expect DELETE 8, then COMMIT;   (or ROLLBACK;)
```

Outside the database: remove or disable `0025CA0000005722` in TTS (`cw-jp-air-th`) so it cannot
transmit again; if it keeps transmitting after being deleted here, add it to
`cw-data-handler-ts/.../TTI/excludedDevices.ts` or its uplinks will cycle the dead-letter queue.
If the local Postgres twin keeps its own `cw_air_data`, its history for this freezer is still under
the old EUI. `upload_interval` stays 15; the new firmware reports every 10 minutes.

## Backups and rollback

`01` copies every row it is about to touch into a private `maintenance` schema (not exposed
through PostgREST) as `devswap_5722_to_7a10__*`, plus the key list of the moved readings.
`02_rollback.sql` uses them to restore the old device row exactly, move back exactly the rows
that were moved, and put the new device row back to "JA Pipe Device" with no location/group. The
new sensor's own readings (before and after the cut-over) stay under its EUI. Drop the schema by
hand once you no longer need the backups.

## How this was tested

Rehearsed on a throwaway local Postgres built from the production catalog (same columns, PK /
UNIQUE / CHECK constraints, unique indexes, and the FKs to `cw_devices` / `cw_air_data`), seeded
to mirror production: the old device with 12,227 readings, 5 owners, triggered rule state, 73 log
rows and a report; the new device as it really is (existing "JA Pipe Device" row, 67 readings, no
owners); and トンネルフリーザー2 sharing rule template 9. 44 checks: the dry run leaves every table
byte-identical; the real run is exact — moved values checksum-identical, the new sensor's own
readings and hardware columns untouched; a reading arriving mid-run does not cause a false
failure; a second run is refused; unexpected states are refused (new EUI already has rules,
overlapping timestamps, wrong name/location/type, rows on both sides); `rename` and `delete`
variants; the not-yet-registered and registered-with-owner-rows variants; and rollback restores
the original state byte-for-byte in every scenario. Local server was PostgreSQL 16.2, production
is 17.4. `03` was tested against a stub of the Storage API only. **Nothing here has been run
against production** — not even as a dry run.

## Status and clean-up

Applied 2026-09-19 00:32:36 JST (`old_device_action = 'rename'`) and verified; the 12 report PDFs
were copied at about 01:00 JST (names, sizes and ETags identical).

Clean-up of the old sensor, in this order:

1. **TTS** (by hand — permanent): application `cw-jp-air-th` → end device
   `eui-0025ca0000005722` → *Settings* → *Delete end device*. Do this first so the unit can
   never uplink into a platform that no longer knows it (such uplinks cycle the ingest's
   dead-letter queue 24 times and end up parked).
2. **Database**: `04_delete_old_device.sql` — refuses unless the row is the tombstone, `01`'s
   backup exists, the replacement holds the history, and no table references the old EUI (the
   FKs are mostly `ON DELETE CASCADE`). `02_rollback.sql` still works afterwards: it re-creates
   the row from the backup.
3. **Storage** (optional): `05_delete_old_report_pdfs.py`. The originals are unreferenced and
   about 450 KB; keep them if you might still roll back.

`04` was rehearsed on the local replica (11 checks, including that the rollback still restores
the original state after it) and `05` against a stub of the Storage API (it deletes only files
with an identical copy, leaves the rest, never touches the new folder).

Last of all, when you are sure you will not roll back: `DROP SCHEMA maintenance CASCADE;`
