#!/usr/bin/env python3
"""Put the weekly report PDFs under the EUI that now carries each report.

The report PDFs live in the "Reports" storage bucket as "<dev_eui>/<period>.pdf", and the API
builds a device's report history with storage.list(<dev_eui>). After 01_swap_sensors.sql:
  * the 工場冷蔵庫 report (template 1) belongs to 343634315F33780C, but its 42 PDFs are in
    2CF7F1C061700171/  -> they are MOVED to 343634315F33780C/
  * the 冷凍コンテナ③ report (template 4) belongs to 2CF7F1C061700171, but its 15 PDFs are in
    2CF7F1C053000110/  -> they are COPIED to 2CF7F1C061700171/ (originals stay)
The two sets share 15 file names (same weeks), so the fridge PDFs have to leave
2CF7F1C061700171/ before the container PDFs can arrive; that is why the fridge set is moved rather
than copied. Only PDFs whose period ended before the swap day are touched: reports generated after
01 already land in the right folder.

A file in 2CF7F1C061700171/ is recognised as a container copy by having the same name, size and
ETag as the original in 2CF7F1C053000110/, so the script is safe to run again after a partial
run, and --rollback undoes exactly what it did. It must go through the Storage API — renaming rows
in storage.objects with SQL would orphan the files in the object store.

Dry run by default; pass --apply to change anything. Standard library only.

    export SUPABASE_URL=https://<project>.supabase.co
    export SUPABASE_SERVICE_ROLE_KEY=...          # same variables the report sender uses
    python3 02_move_report_pdfs.py                # show the plan
    python3 02_move_report_pdfs.py --apply
    python3 02_move_report_pdfs.py --rollback [--apply]
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
import urllib.error
import urllib.request

BUCKET = "Reports"
MOVED_EUI = "2CF7F1C061700171"     # fridge sensor until 2026-10-28, container sensor since
RETIRED_EUI = "2CF7F1C053000110"   # container sensor until 2026-10-28
FRIDGE_EUI = "343634315F33780C"    # fridge sensor since 2026-10-28
SWAP_DAY = dt.date(2026, 10, 28)

# "2026_10_18-2026_10_24.pdf", and regenerated variants "2026_10_18-2026_10_24_updated_<ts>.pdf"
PERIOD = re.compile(r"^(\d{4})_(\d{2})_(\d{2})-(\d{4})_(\d{2})_(\d{2})")


def call(base: str, key: str, method: str, path: str, body: dict) -> object:
    req = urllib.request.Request(
        f"{base.rstrip('/')}/storage/v1/{path}",
        data=json.dumps(body).encode(),
        method=method,
        headers={"Authorization": f"Bearer {key}", "apikey": key, "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read() or b"null")
    except urllib.error.HTTPError as err:
        raise SystemExit(f"Storage API {method} {path} -> HTTP {err.code}: {err.read().decode(errors='replace')[:300]}")


def list_folder(base: str, key: str, folder: str) -> dict[str, tuple]:
    """name -> (size, eTag) of the files directly in <folder>/."""
    files: dict[str, tuple] = {}
    offset = 0
    while True:
        page = call(base, key, "POST", f"object/list/{BUCKET}",
                    {"prefix": folder, "limit": 100, "offset": offset, "sortBy": {"column": "name", "order": "asc"}})
        if not isinstance(page, list):
            raise SystemExit(f"Unexpected list response: {page!r}")
        for item in page:
            if item.get("id"):   # entries without an id are sub-folders, not files
                meta = item.get("metadata") or {}
                files[item["name"]] = (meta.get("size"), meta.get("eTag"))
        if len(page) < 100:
            return files
        offset += 100


def before_swap(name: str) -> bool:
    m = PERIOD.match(name)
    if not m:
        raise SystemExit(f"Unrecognised report file name {name!r} — sort it out by hand before running this")
    return dt.date(int(m[4]), int(m[5]), int(m[6])) < SWAP_DAY


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--apply", action="store_true", help="actually change the bucket (default: dry run)")
    parser.add_argument("--rollback", action="store_true", help="undo: delete the container copies, move the fridge PDFs back")
    args = parser.parse_args()

    base = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not base or not key:
        raise SystemExit("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set")

    moved = list_folder(base, key, MOVED_EUI)
    retired = list_folder(base, key, RETIRED_EUI)
    fridge = list_folder(base, key, FRIDGE_EUI)
    for folder, files in ((MOVED_EUI, moved), (RETIRED_EUI, retired), (FRIDGE_EUI, fridge)):
        print(f"{BUCKET}/{folder}/ : {len(files)} file(s)")

    container = sorted(n for n in retired if before_swap(n))
    copies = {n for n in container if moved.get(n) == retired[n]}          # already copied in
    fridge_in_moved = sorted(n for n in moved if before_swap(n) and n not in copies)

    steps: list[tuple] = []   # (method, path, body, label)
    if not args.rollback:
        clash = [n for n in fridge_in_moved if n in fridge]
        if clash:
            raise SystemExit(f"{len(clash)} fridge PDF(s) exist in both {MOVED_EUI}/ and {FRIDGE_EUI}/ — stop and look: {clash}")
        for n in fridge_in_moved:
            steps.append(("POST", "object/move", {"bucketId": BUCKET, "sourceKey": f"{MOVED_EUI}/{n}", "destinationKey": f"{FRIDGE_EUI}/{n}"},
                          f"move  {MOVED_EUI}/{n}  ->  {FRIDGE_EUI}/{n}"))
        for n in container:
            if n not in copies:
                steps.append(("POST", "object/copy", {"bucketId": BUCKET, "sourceKey": f"{RETIRED_EUI}/{n}", "destinationKey": f"{MOVED_EUI}/{n}"},
                              f"copy  {RETIRED_EUI}/{n}  ->  {MOVED_EUI}/{n}"))
    else:
        if copies:
            steps.append(("DELETE", f"object/{BUCKET}", {"prefixes": [f"{MOVED_EUI}/{n}" for n in sorted(copies)]},
                          f"delete the {len(copies)} container copies in {MOVED_EUI}/ (originals stay in {RETIRED_EUI}/)"))
        back = sorted(n for n in fridge if before_swap(n))
        clash = [n for n in back if n in moved and n not in copies]
        if clash:
            raise SystemExit(f"{len(clash)} fridge PDF(s) exist in both {FRIDGE_EUI}/ and {MOVED_EUI}/ — stop and look: {clash}")
        for n in back:
            steps.append(("POST", "object/move", {"bucketId": BUCKET, "sourceKey": f"{FRIDGE_EUI}/{n}", "destinationKey": f"{MOVED_EUI}/{n}"},
                          f"move  {FRIDGE_EUI}/{n}  ->  {MOVED_EUI}/{n}"))

    print(f"{len(steps)} step(s)" + ("" if args.apply else "   (dry run — pass --apply to run them)"))
    for method, path, body, label in steps:
        if args.apply:
            call(base, key, method, path, body)
        print(("  done   " if args.apply else "  would  ") + label)
    if not args.apply:
        return 0

    # verify against a fresh listing
    moved_after = list_folder(base, key, MOVED_EUI)
    fridge_after = list_folder(base, key, FRIDGE_EUI)
    if not args.rollback:
        problems = [f"{FRIDGE_EUI}/{n} missing" for n in fridge_in_moved if fridge_after.get(n) != moved[n]]
        problems += [f"{MOVED_EUI}/{n} is not a copy of {RETIRED_EUI}/{n}" for n in container if moved_after.get(n) != retired[n]]
    else:
        problems = [f"{MOVED_EUI}/{n} missing" for n in fridge if before_swap(n) and moved_after.get(n) != fridge[n]]
        problems += [f"{FRIDGE_EUI}/{n} still there" for n in fridge_after if before_swap(n)]
    if problems:
        print(f"FAILED: {len(problems)} problem(s): {problems}")
        return 1
    print("OK: " + ("fridge PDFs are under " + FRIDGE_EUI + "/, container PDFs under " + MOVED_EUI + "/"
                    if not args.rollback else "back to the state before --apply"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
