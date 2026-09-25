#!/usr/bin/env python3
"""Make the old sensor's report PDFs visible under the replacement sensor.

The weekly report PDFs live in the "Reports" storage bucket as "<dev_eui>/<period>.pdf", and the
API builds a device's report history with storage.list(<dev_eui>). After 01_replace_device.sql
the report assignment points at the NEW EUI, so the existing PDFs (under the OLD EUI's folder)
drop out of the UI until they also exist under the new folder.

This COPIES them (the originals stay where they are, so it is trivially reversible: delete the
copies). It must go through the Storage API — renaming rows in storage.objects with SQL would
orphan the files in the object store.

Dry run by default; pass --apply to copy. Files that already exist at the destination are skipped,
so it is safe to run more than once. Standard library only.

    export SUPABASE_URL=https://<project>.supabase.co
    export SUPABASE_SERVICE_ROLE_KEY=...          # same variables the report sender uses
    python3 03_copy_report_pdfs.py                # list what would be copied
    python3 03_copy_report_pdfs.py --apply
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

BUCKET = "Reports"
OLD_EUI = "0025CA0000005722"
NEW_EUI = "3436343159337A10"


def call(base: str, key: str, path: str, body: dict) -> object:
    req = urllib.request.Request(
        f"{base.rstrip('/')}/storage/v1/{path}",
        data=json.dumps(body).encode(),
        method="POST",
        headers={"Authorization": f"Bearer {key}", "apikey": key, "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read() or b"null")
    except urllib.error.HTTPError as err:
        raise SystemExit(f"Storage API {path} -> HTTP {err.code}: {err.read().decode(errors='replace')[:300]}")


def list_folder(base: str, key: str, folder: str) -> list[str]:
    names: list[str] = []
    offset = 0
    while True:
        page = call(base, key, f"object/list/{BUCKET}",
                    {"prefix": folder, "limit": 100, "offset": offset, "sortBy": {"column": "name", "order": "asc"}})
        if not isinstance(page, list):
            raise SystemExit(f"Unexpected list response: {page!r}")
        # entries without an id are sub-folders, not files
        names += [item["name"] for item in page if item.get("id")]
        if len(page) < 100:
            return names
        offset += 100


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--apply", action="store_true", help="actually copy (default: dry run)")
    args = parser.parse_args()

    base = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not base or not key:
        raise SystemExit("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set")

    source = list_folder(base, key, OLD_EUI)
    existing = set(list_folder(base, key, NEW_EUI))
    todo = [name for name in source if name not in existing]

    print(f"{BUCKET}/{OLD_EUI}/ : {len(source)} file(s)")
    print(f"{BUCKET}/{NEW_EUI}/ : {len(existing)} file(s) already present")
    print(f"to copy             : {len(todo)}" + ("" if args.apply else "   (dry run — pass --apply to copy)"))

    for name in todo:
        if args.apply:
            call(base, key, "object/copy",
                 {"bucketId": BUCKET, "sourceKey": f"{OLD_EUI}/{name}", "destinationKey": f"{NEW_EUI}/{name}"})
        print(("  copied  " if args.apply else "  would copy  ") + f"{OLD_EUI}/{name}  ->  {NEW_EUI}/{name}")

    if args.apply:
        after = set(list_folder(base, key, NEW_EUI))
        missing = [name for name in source if name not in after]
        if missing:
            print(f"FAILED: {len(missing)} file(s) are still missing at the destination: {missing}")
            return 1
        print(f"OK: all {len(source)} file(s) are now present under {NEW_EUI}/ (originals untouched)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
