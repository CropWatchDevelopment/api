# RLS posture: API-only (deny by default)

## Decision

All client data access goes through the NestJS API. The database itself denies
everything to the PostgREST roles:

- **RLS enabled on every `public` table** (`updates/002`).
- **No policies** for `anon` / `authenticated` / `public` (`updates/003` drops
  the legacy ones). RLS with no matching policy = deny.
- **No table/sequence grants** for `anon` / `authenticated`, including default
  privileges for future objects (`updates/004`).
- **SECURITY DEFINER functions not executable** by API roles (`updates/005`).
- **Foreign tables** (Stripe FDW — exempt from RLS by design) moved to a
  non-exposed schema (`updates/006`).

The API is unaffected: it uses the **service-role** key, which has
`BYPASSRLS`. The two explicit `service_role` policies (`api_keys`,
`babylon_in_connections`) are kept for documentation value even though the
role bypasses RLS anyway.

## Why not mirror the permission model in RLS?

Defense-in-depth policies would duplicate the location/device permission
logic in SQL and TypeScript, and the two *will* drift (the tautological
telemetry policies found in the review are exactly that failure mode). A
single enforcement point in the API, plus a database that denies everything
else, is simpler to reason about and audit.

Trade-off: the browser cannot use supabase-js for data or Realtime
subscriptions. If Realtime is wanted later, add narrowly-scoped **read-only**
policies for just those tables (and re-run the security advisor afterwards).

## What keeps working, and why

| Concern | Why it's safe |
|---|---|
| Login / JWT issuance | The `auth` schema is untouched; GoTrue uses its own role (`supabase_auth_admin`) |
| New-user signup → `public.profiles` row | `handle_new_user()` is SECURITY DEFINER and owned by `postgres` (table owner). Owner access is unaffected because we do **not** use `FORCE ROW LEVEL SECURITY`. Its EXECUTE is explicitly granted to `supabase_auth_admin` in `updates/005`. Trigger firing does not check the caller's EXECUTE privilege. |
| API data access | service_role bypasses RLS and keeps full grants |
| Storage avatar cleanup triggers (`delete_old_avatar` chain) | Trigger functions; EXECUTE is checked at trigger creation, not at fire time |
| Realtime broadcast triggers (`cw_*_data_changes`) | Same — fired by service-role writes |

## Verifying the posture

```bash
# Direct PostgREST read with the anon key must be denied:
curl -s "https://<project>.supabase.co/rest/v1/cw_devices?select=dev_eui&limit=1" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY"
# expected: {"code":"42501", ...} permission denied

# RPC with the anon key must be denied:
curl -s -X POST "https://<project>.supabase.co/rest/v1/rpc/is_device_owner_for" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" \
  -H "Content-Type: application/json" -d '{"dev":"test"}'
# expected: permission denied
```

Then re-run the Supabase **security advisor** — the `rls_disabled_in_public`,
`policy_exists_rls_disabled`, `sensitive_columns_exposed`,
`anon_security_definer_function_executable` and `foreign_table_in_api` lints
must all be clear.

## Rules for future tables

1. Create the table; RLS is *not* automatic — `ALTER TABLE ... ENABLE ROW
   LEVEL SECURITY;` in the same migration.
2. Do **not** grant anything to `anon`/`authenticated` (the default-privilege
   revokes in `updates/004` make this the default, but don't fight it).
3. Access the table from the API only, behind the scope helpers and
   `permission-levels.ts` thresholds.
