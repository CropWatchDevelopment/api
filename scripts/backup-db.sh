#!/usr/bin/env bash
# =============================================================================
# backup-db.sh — reusable backup of the CropWatch Supabase Postgres.
# =============================================================================
# WHY PER-TABLE: the Supabase session pooler (Supavisor) silently stalls mid-COPY
# on a large single-stream dump — it froze forever on cw_air_data. The direct
# endpoint (db.<ref>.supabase.co) avoids the stall but is IPv6-only, so it's
# unreachable from most networks. Reliable method: dump the schema once, then dump
# each table's DATA separately, smallest-first, each wrapped in a per-table
# `timeout` so one bad table can't hang the whole run.
#
# REQUIRES pg_dump / psql v17+ (server is PG17). Ubuntu/Debian:
#   sudo apt install -y postgresql-client-17        # from apt.postgresql.org (PGDG)
#
# CONNECTION — use the SESSION pooler (port 5432); the transaction pooler (6543)
# will NOT work with pg_dump. Provide it one of two ways:
#   export SUPABASE_DB_URL='postgresql://postgres.dpaoqrcfswnzknixwkll:PW@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres?sslmode=require'
#   export SUPABASE_DB_PASSWORD='...'    # URL built from the known host/ref
# Find it in: Supabase dashboard -> Connect -> Session pooler.
#
# OUTPUT  backups/<UTC-timestamp>/  (gitignored):
#   schema.sql.gz   data/<schema>_<table>.sql.gz   MANIFEST.txt
#
# RESTORE:
#   gunzip -c schema.sql.gz | psql "$SUPABASE_DB_URL"                  # structure
#   gunzip -c data/public_cw_air_data.sql.gz | psql "$SUPABASE_DB_URL" # one table
#   (data dumps use --disable-triggers, so FK order doesn't matter on restore.)
# =============================================================================

set -euo pipefail

usage() {
  cat <<EOF
backup-db.sh — per-table backup of the CropWatch Supabase DB.

Set credentials first (SESSION pooler, port 5432):
  export SUPABASE_DB_PASSWORD='...'        # or full SUPABASE_DB_URL='postgres://...'

Usage:
  ./scripts/backup-db.sh                 # schema + all public-schema table data
  ./scripts/backup-db.sh -t cw_air_data  # one table's data only
  ./scripts/backup-db.sh -s              # schema only
  ./scripts/backup-db.sh -d              # data only (skip schema)

Env knobs:
  TABLE_TIMEOUT=1800     per-table stall guard, seconds (default 900)
  DATA_SCHEMAS='public'  schemas whose table DATA to dump (default public)
  BACKUP_ROOT=/path      output root (default <repo>/backups)
EOF
}

# ---- options / args (handle -h before anything that needs credentials) ------
TABLE_TIMEOUT="${TABLE_TIMEOUT:-900}"
DATA_SCHEMAS="${DATA_SCHEMAS:-public}"
SCHEMA_NS="${SCHEMA_NS:-public auth storage}"
BACKUP_ROOT="${BACKUP_ROOT:-$(cd "$(dirname "$0")/.." && pwd)/backups}"
ONLY_TABLE=""; SCHEMA_ONLY=0; DATA_ONLY=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    -t|--table) ONLY_TABLE="$2"; shift 2 ;;
    -s|--schema-only) SCHEMA_ONLY=1; shift ;;
    -d|--data-only)   DATA_ONLY=1;   shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; usage; exit 1 ;;
  esac
done

# ---- locate v17 binaries ----------------------------------------------------
PG_DUMP="$(command -v pg_dump || true)"; PSQL="$(command -v psql || true)"
if [[ -z "$PG_DUMP" || "$("$PG_DUMP" --version 2>/dev/null | grep -oE '[0-9]+' | head -1)" != "17" ]]; then
  if [[ -x /usr/lib/postgresql/17/bin/pg_dump ]]; then
    PG_DUMP=/usr/lib/postgresql/17/bin/pg_dump; PSQL=/usr/lib/postgresql/17/bin/psql
  fi
fi
[[ -n "$PG_DUMP" ]] || { echo "ERROR: pg_dump not found. Install postgresql-client-17." >&2; exit 1; }
ver="$("$PG_DUMP" --version | grep -oE '[0-9]+' | head -1)"
[[ "$ver" -ge 17 ]] || { echo "ERROR: pg_dump is v$ver; need v17+ (server is PG17)." >&2; exit 1; }

# ---- connection string ------------------------------------------------------
REF="dpaoqrcfswnzknixwkll"; POOLER_HOST="aws-0-ap-northeast-1.pooler.supabase.com"
if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  if [[ -n "${SUPABASE_DB_PASSWORD:-}" ]]; then
    SUPABASE_DB_URL="postgresql://postgres.${REF}:${SUPABASE_DB_PASSWORD}@${POOLER_HOST}:5432/postgres?sslmode=require"
  else
    echo "ERROR: set SUPABASE_DB_PASSWORD (or full SUPABASE_DB_URL). See -h." >&2; exit 1
  fi
fi

mask() { sed -E 's,://([^:]+):[^@]+@,://\1:****@,'; }
log()  { printf '%s  %s\n' "$(date -u +%H:%M:%S)" "$*"; }

# ---- connectivity check (fail fast, before creating any output) -------------
log "testing connection to $(printf '%s' "$SUPABASE_DB_URL" | mask) ..."
"$PSQL" "$SUPABASE_DB_URL" -Atc 'select 1' >/dev/null 2>&1 || {
  echo "ERROR: cannot connect. Check the password and that you used the SESSION pooler (port 5432)." >&2
  exit 1; }
log "connected."

# ---- prepare output ---------------------------------------------------------
STAMP="$(date -u +%Y-%m-%d_%H%M%SZ)"
OUTDIR="$BACKUP_ROOT/$STAMP"; DATADIR="$OUTDIR/data"; MANIFEST="$OUTDIR/MANIFEST.txt"
mkdir -p "$DATADIR"
{
  echo "CropWatch DB backup"
  echo "started_utc    : $STAMP"
  echo "pg_dump        : $("$PG_DUMP" --version)"
  echo "target         : $(printf '%s' "$SUPABASE_DB_URL" | mask)"
  echo "data_schemas   : $DATA_SCHEMAS"
  echo "table_timeout_s: $TABLE_TIMEOUT"
  echo "----------------------------------------------------------------------"
} | tee "$MANIFEST"

# ---- schema dump ------------------------------------------------------------
if [[ "$DATA_ONLY" -eq 0 && -z "$ONLY_TABLE" ]]; then
  log "dumping schema ($SCHEMA_NS) ..."
  ns_args=(); for ns in $SCHEMA_NS; do ns_args+=(-n "$ns"); done
  if timeout "$TABLE_TIMEOUT" "$PG_DUMP" "$SUPABASE_DB_URL" --schema-only --no-owner --no-privileges \
        "${ns_args[@]}" -f "$OUTDIR/schema.sql"; then
    gzip -f "$OUTDIR/schema.sql"
    echo "OK    schema.sql.gz   ($(du -h "$OUTDIR/schema.sql.gz" | cut -f1))" | tee -a "$MANIFEST"
  else
    echo "FAIL  schema dump" | tee -a "$MANIFEST"; exit 1
  fi
fi
[[ "$SCHEMA_ONLY" -eq 1 ]] && { log "schema-only done -> $OUTDIR"; exit 0; }

# ---- table list (smallest-first) --------------------------------------------
if [[ -n "$ONLY_TABLE" ]]; then
  [[ "$ONLY_TABLE" == *.* ]] || ONLY_TABLE="public.$ONLY_TABLE"
  tables=("$ONLY_TABLE|?")
else
  log "listing tables in: $DATA_SCHEMAS"
  mapfile -t tables < <("$PSQL" "$SUPABASE_DB_URL" -Atc "
    SELECT format('%I.%I', n.nspname, c.relname) || '|' || c.reltuples::bigint
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r'
      AND n.nspname = ANY (string_to_array('$DATA_SCHEMAS', ' '))
    ORDER BY pg_total_relation_size(c.oid) ASC, n.nspname, c.relname;")
fi
log "${#tables[@]} table(s) to dump."

# ---- per-table data dump ----------------------------------------------------
ok=0; failed=0; fail_list=()
for entry in "${tables[@]}"; do
  [[ -n "$entry" ]] || continue
  tbl="${entry%%|*}"; est="${entry##*|}"
  safe="${tbl//./_}"; safe="${safe//\"/}"
  out="$DATADIR/$safe.sql"
  log "dump $tbl  (~${est} rows)"
  if timeout "$TABLE_TIMEOUT" "$PG_DUMP" "$SUPABASE_DB_URL" \
        --data-only --no-sync --no-owner --no-privileges --disable-triggers \
        -t "$tbl" -f "$out"; then
    gzip -f "$out"
    echo "OK    data/$safe.sql.gz   (~${est} rows, $(du -h "$out.gz" | cut -f1))" | tee -a "$MANIFEST"
    ok=$((ok+1))
  else
    rc=$?; rm -f "$out"
    reason=$([[ $rc -eq 124 ]] && echo "TIMEOUT(${TABLE_TIMEOUT}s)" || echo "ERROR(rc=$rc)")
    echo "FAIL  $tbl   $reason" | tee -a "$MANIFEST"
    fail_list+=("$tbl ($reason)"); failed=$((failed+1))
  fi
done

# ---- summary ----------------------------------------------------------------
{
  echo "----------------------------------------------------------------------"
  echo "finished_utc: $(date -u +%Y-%m-%d_%H%M%SZ)"
  echo "tables_ok   : $ok"
  echo "tables_fail : $failed"
  echo "total_size  : $(du -sh "$OUTDIR" | cut -f1)"
} | tee -a "$MANIFEST"

log "backup at: $OUTDIR"
if [[ "$failed" -gt 0 ]]; then
  log "WARNING: $failed table(s) failed — re-run those with a bigger TABLE_TIMEOUT, e.g.:"
  printf '  TABLE_TIMEOUT=1800 %s -t %s\n' "$0" "${fail_list[0]%% *}"
  exit 2
fi
log "done — all tables captured."
