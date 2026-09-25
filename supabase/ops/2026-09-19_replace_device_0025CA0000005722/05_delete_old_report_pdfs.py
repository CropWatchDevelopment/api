#!/usr/bin/env python3
"""OPTIONAL: remove the report PDFs left under the replaced sensor's storage folder.

03_copy_report_pdfs.py copied "Reports/0025CA0000005722/*.pdf" to "Reports/3436343159337A10/".
The originals are now unreferenced (the API only lists folders of devices that have a report
assignment) and harmless to keep — about 450 KB in total. Deleting them is irreversible, so:

  * a file is deleted ONLY if a copy with the same name, size and ETag exists under the new EUI;
    anything without an identical copy is left alone and reported;
  * dry run by default; pass --apply to delete.

If you might still use 02_rollback.sql, keep the originals until you drop the backups: after a
rollback the old device would own the report assignment again, and the API would look for the
PDFs in the old folder.

    set -a; source ~/source/repos/cropwatch/cw-reports-new/.env; set +a
    python3 05_delete_old_report_pdfs.py            # list what would be deleted
    python3 05_delete_old_report_pdfs.py --apply
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
    """name -> (size, eTag) for every file directly inside the folder."""
    files: dict[str, tuple] = {}
    offset = 0
    while True:
        page = call(base, key, "POST", f"object/list/{BUCKET}",
                    {"prefix": folder, "limit": 100, "offset": offset, "sortBy": {"column": "name", "order": "asc"}})
        if not isinstance(page, list):
            raise SystemExit(f"Unexpected list response: {page!r}")
        for item in page:
            if item.get("id"):                                  # entries without an id are sub-folders
                meta = item.get("metadata") or {}
                files[item["name"]] = (meta.get("size"), meta.get("eTag"))
        if len(page) < 100:
            return files
        offset += 100


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--apply", action="store_true", help="actually delete (default: dry run)")
    args = parser.parse_args()

    base = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not base or not key:
        raise SystemExit("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set")

    old = list_folder(base, key, OLD_EUI)
    new = list_folder(base, key, NEW_EUI)

    safe, kept = [], []
    for name, fingerprint in sorted(old.items()):
        identical = name in new and None not in fingerprint and new[name] == fingerprint
        (safe if identical else kept).append(name)

    print(f"{BUCKET}/{OLD_EUI}/ : {len(old)} file(s)")
    print(f"identical copy under {NEW_EUI}/ : {len(safe)}   |   without one (left alone): {len(kept)}")
    for name in kept:
        print(f"  KEEPING  {OLD_EUI}/{name}   (no identical copy at the destination)")
    for name in safe:
        print(("  deleting  " if args.apply else "  would delete  ") + f"{OLD_EUI}/{name}")

    if not args.apply:
        print("dry run — pass --apply to delete")
        return 0
    if safe:
        call(base, key, "DELETE", f"object/{BUCKET}", {"prefixes": [f"{OLD_EUI}/{name}" for name in safe]})

    left = list_folder(base, key, OLD_EUI)
    still_new = list_folder(base, key, NEW_EUI)
    if set(left) != set(kept) or any(name not in still_new for name in safe):
        print(f"FAILED: unexpected state afterwards — old folder has {sorted(left)}")
        return 1
    print(f"OK: deleted {len(safe)} original(s); {len(still_new)} file(s) remain under {NEW_EUI}/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
