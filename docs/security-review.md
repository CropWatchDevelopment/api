# CropWatch security review — 2026-06-10

Scope: Supabase PostgreSQL project, NestJS API (`api`), SvelteKit web app
(`CropWatch`), component library (`CWUI`). Database findings come from the
live project via the Supabase advisors and direct catalog queries (read-only).

## Architecture (what protects what)

- The **NestJS API** authenticates requests with Supabase JWTs
  (`src/v1/auth/strategies/supabase.strategy.ts`) and performs **all** data
  access with the **service-role key** (`src/supabase/supabase.module.ts`).
  The service-role key bypasses RLS, so authorization lives entirely in the
  API's scope helpers (`applyDeviceReadScope`, `applyLocationManageScope`, …).
- The **web app** uses Supabase only for auth; every data call goes through
  the API with the user's JWT.
- Consequence: any RLS policy or table grant for `anon` / `authenticated` is
  not "the security model" — it is **extra attack surface** reachable via
  PostgREST (`https://<project>.supabase.co/rest/v1/...`) with the public anon
  key that ships in the browser bundle.

Chosen posture (see [`rls-posture.md`](./rls-posture.md)): **API-only** —
RLS enabled everywhere, no anon/authenticated policies or grants.

## Critical findings (database)

| # | Finding | Impact | Fix |
|---|---|---|---|
| 1 | **23 tables had RLS disabled** (`devices`, `permissions`, `cw_rule_criteria`, `report_user_schedule`, `user_discord_connections`, `cw_water_data`, `report_alert_points`, `report_recipients`, `cw_air_annotations`, `report_data_processing_schedules`, all `cw_rule_template*` / `cw_report_template*` tables, `cw_device_rule_assignments`, `cw_rule_state`, `cw_rule_trigger_log`, `cw_rule_monthly_usage`) | Anyone with the anon key can **read and write every row** via PostgREST | `updates/002` + `004` |
| 2 | **`user_discord_connections` exposes a Discord `access_token` column** with no RLS | Token theft with the public anon key | `updates/002` + `004`; table dropped outright in `updates/009` (Discord no longer used) — revoke the app in the Discord developer portal |
| 3 | **Tautological telemetry policies**: the SELECT policies on `cw_air_data`, `cw_soil_data`, `cw_relay_data` compare `cw_device_owners` columns to themselves (`dev_eui = dev_eui AND user_id = user_id`), so *any* signed-in user could read **all** telemetry of all customers | Cross-tenant data leak | `updates/003` |
| 4 | **`cw_traffic2` allowed anonymous INSERT and UPDATE of any row** (`with_check = true`, `using = true`) and world SELECT | Data tampering / pollution | `updates/003` |
| 5 | **`profiles` was world-readable** (`select = true` to `public`) — all 105 user emails/names | PII leak | `updates/003` |
| 6 | **15 SECURITY DEFINER functions executable by `anon`/`authenticated`** via `/rest/v1/rpc/`, incl. `delete_storage_object` (makes authenticated HTTP calls with an embedded service-role key) and the `is_*_for()` permission helpers | Privilege escalation surface | `updates/005` |
| 7 | **3 Stripe foreign tables exposed in a PostgREST schema** — foreign tables don't respect RLS | Live Stripe customer/subscription data readable with the anon key | `updates/006` drops the whole Stripe FDW stack (Stripe no longer used); also revoke the Stripe API key and delete its Vault secret |
| 8 | 11 functions with **mutable `search_path`** | Search-path hijack risk for SECURITY DEFINER bodies | `updates/005` |

## API findings

| # | Finding | Fix |
|---|---|---|
| 9 | `GET/PATCH/DELETE /v1/power/:id` had **no `JwtAuthGuard`** | Guard added at controller level |
| 10 | WebSocket realtime gateway (`src/v1/realtime/`) had **no auth** and no consumers (Nest scaffold) | Module deleted |
| 11 | `POST /v1/relay/tti/up` webhook auth **failed open** when `PRIVATE_TTI_WEBHOOK_TOKEN` was unset | Now fails closed (401) + startup warning |
| 12 | Old `/v1/reports` POST **did not verify device permission** before creating a report on any `dev_eui`; old `/v1/rules` used a different (location-based) model | Old modules removed; template-based `rules-new` / `reports-new` enforce manager-level (`<= 2`) checks |
| 13 | **@cropwatch.io staff rows were filtered client-side only** — the API returned staff emails to non-staff users; hiding happened in Svelte templates | Filtering moved server-side (`owner-filter.helper.ts`), client filters removed |
| 14 | Permission thresholds were **magic numbers** (`< 4`, `<= 2`) scattered across services/DTOs | Centralized in `src/v1/common/permission-levels.ts`; model extended to 5 levels (see [`permission-model.md`](./permission-model.md)) |

## Accepted risks / follow-ups

- **Staff bypass by email suffix.** `isCropwatchStaff()` grants global access
  to any JWT whose email ends in `@cropwatch.io`. This is acceptable while
  all `@cropwatch.io` accounts are company-controlled (signups are
  email-confirmed). *Follow-up:* move to a server-set
  `app_metadata.role = 'staff'` claim and check that instead.
- **Project-level dashboard actions** (not scriptable from SQL):
  - Enable leaked-password protection (Auth settings).
  - Upgrade Postgres — `supabase-postgres-17.4.1.074` has outstanding
    security patches.
  - Auth server uses a fixed pool of 10 DB connections; switch to
    percentage-based allocation when upsizing.
- **Legacy tables** (`devices`, `locations`, `permissions`, `*_duplicate`,
  old rules/reports tables) remain until `updates/008` is run manually.

## Performance notes (advisor)

- 5 duplicate index pairs and 1 unused index dropped, FK indexes added for the
  permission-scoping joins — `updates/007`.
- 36 unindexed FKs were reported; only those on hot API paths were indexed.
  The rest are cold/legacy tables where index write cost outweighs benefit.
- `cw_air_alerts` has no primary key (optional fix commented in `updates/007`).
- 19 `auth_rls_initplan` warnings became moot once the policies were dropped.
