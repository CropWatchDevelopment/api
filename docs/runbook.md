# Operations runbook — every step, in order

Companion to [`rollout-plan.md`](./rollout-plan.md) (the summary checklist).
This file lists **every operation** required to take the June 2026 work live:
what to run, where, why, and links to every file involved.

Repos referenced (siblings on disk):

| Repo | Path | Role |
|---|---|---|
| `api` | `~/source/repos/cropwatch/api` | NestJS API + SQL scripts + docs (this repo) |
| `CWUI` | `~/source/repos/cropwatch/CWUI` | Svelte 5 component library (`@cropwatchdevelopment/cwui`) |
| `CropWatch` | `~/source/repos/cropwatch/CropWatch` | SvelteKit web app |

---

## Phase 0 — Pre-flight (no behavior change)

| # | Operation | Where | Why |
|---|---|---|---|
| 0.1 | Review & commit the working-tree changes in all three repos (suggested order: CWUI → api → CropWatch) | all repos | Everything below assumes these commits exist |
| 0.2 | Set `PRIVATE_TTI_WEBHOOK_TOKEN` in the API deployment env **and** configure the same bearer token / `X-Downlink-Apikey` on the TTI webhook | API env + TTI console | [`relay.service.ts`](../src/v1/relay/relay.service.ts) now **fails closed** — without the env var every relay uplink is rejected after deploy |
| 0.3 | Run [`supabase/updates/000_preflight_report.sql`](../supabase/updates/000_preflight_report.sql) (read-only) and save the output | Supabase SQL editor | Baseline snapshot: RLS state, policies, grants, permission-level distribution, SECURITY DEFINER ACLs. You will diff against this after every later script |

## Phase 1 — Publish CWUI 0.1.106

| # | Operation | Where | Why |
|---|---|---|---|
| 1.1 | Publish the package (`npm run release` / `scripts/release-package.sh`) | `CWUI` | CropWatch's `package.json` now pins `0.1.106`, which adds the device-refresh scheduler ([`src/lib/utils/cwDeviceRefresh.ts`](../../CWUI/src/lib/utils/cwDeviceRefresh.ts), exported via [`src/lib/index.ts`](../../CWUI/src/lib/index.ts)) |
| 1.2 | `pnpm install` in `CropWatch` | `CropWatch` | Replaces the temporary dev symlink `node_modules/@cropwatchdevelopment/cwui -> ../CWUI` with the published package; verify with `pnpm check` (expect 0 errors) |

## Phase 2 — API release A (additive; safe with the OLD database state)

Deploy the `api` repo. The relevant code (all already committed in Phase 0):

| Change | Files | Why |
|---|---|---|
| Triggered-rules endpoints | [`rules-new.controller.ts`](../src/v1/rules-new/rules-new.controller.ts), [`rules-new.service.ts`](../src/v1/rules-new/rules-new.service.ts) | `GET /v1/rules-new/triggered` + `/triggered/count` must exist **before** the UI release switches the alert badge to them |
| Power endpoint guard | [`power.controller.ts`](../src/v1/power/power.controller.ts) | Was completely unauthenticated |
| Realtime module deleted | `src/v1/realtime/` (removed), [`app.module.ts`](../src/app.module.ts) | Unauthenticated WebSocket scaffold with no consumers |
| TTI webhook fail-closed | [`relay.service.ts`](../src/v1/relay/relay.service.ts) | Previously accepted any caller when the token env was unset |
| Server-side staff filtering | [`common/owner-filter.helper.ts`](../src/v1/common/owner-filter.helper.ts), [`locations.service.ts`](../src/v1/locations/locations.service.ts) | @cropwatch.io owner rows must never reach non-staff clients (was client-side hiding only) |
| Stripe/payments module deleted | `src/v1/payments/` (removed), [`app.module.ts`](../src/app.module.ts) | Stripe is no longer used |
| Device-move hand-over | [`devices.service.ts`](../src/v1/devices/devices.service.ts) (`updateDevice`, `resetDevicePermissionsForMove`) | Moving a device now transfers ownership to the destination location owner, wipes old permission rows, seeds members as Disabled, mover as Admin |

> Note: this same deploy also contains the 5-level threshold code
> ([`common/permission-levels.ts`](../src/v1/common/permission-levels.ts) and
> every service that uses it). That is why Phase 3 must follow
> **immediately** — see the warning there.

## Phase 3 — Database permission remap (maintenance window)

| # | Operation | Where | Why |
|---|---|---|---|
| 3.1 | Run [`supabase/updates/001_permission_levels.sql`](../supabase/updates/001_permission_levels.sql) | Supabase SQL editor | Extends the model 4→5 levels: inserts `5 = Disabled`, remaps data **4→5 then 3→4**, renames `2 Editor → Manager`, adds CHECK constraints (1..5). Sentinel-guarded — a second run is a no-op |
| 3.2 | Verify with the script's built-in post-checks + re-run `000` | Supabase SQL editor | Catalog must read 1 Admin / 2 Manager / 3 User / 4 Viewer / 5 Disabled; no rows outside 1–5 |

**⚠ Ordering rule:** the new API (Phase 2) reads `permission_level < 5` as
"can read". Against **un-remapped** data, old `Disabled = 4` users would gain
Viewer access — so run 3.1 in the same window as (or immediately after) the
Phase 2 deploy. The reverse gap (old API + new data) only fails closed.

## Phase 4 — CropWatch release

Deploy the `CropWatch` repo. Keep the gap from Phase 3 short — until this is
live, the old UI's "Disabled" dropdown writes `4`, which now means Viewer.

| Change | Files | Why |
|---|---|---|
| 5-level permission UI | [`lib/constants/permissions.ts`](../../CropWatch/src/lib/constants/permissions.ts), [`lib/i18n/options.ts`](../../CropWatch/src/lib/i18n/options.ts), device/location settings pages | Dropdowns must write the new level numbers; `Disabled` fallbacks are now `5` |
| Rules/reports route takeover | `src/routes/rules/**`, `src/routes/reports/**` (template pages moved in), redirect stubs [`rules-new/[...path]/+page.server.ts`](../../CropWatch/src/routes/rules-new/%5B...path%5D/+page.server.ts) & [`reports-new/[...path]/+page.server.ts`](../../CropWatch/src/routes/reports-new/%5B...path%5D/+page.server.ts), [`Sidebar.svelte`](../../CropWatch/src/routes/Sidebar.svelte) | Old weak-permission pages deleted; clean URLs serve the template system; bookmarks redirect |
| Alert badge → new endpoints | [`+layout.server.ts`](../../CropWatch/src/routes/+layout.server.ts), [`lib/api/api.service.ts`](../../CropWatch/src/lib/api/api.service.ts), [`OverviewDrawer.svelte`](../../CropWatch/src/routes/OverviewDrawer.svelte) | Consumes `/v1/rules-new/triggered(+/count)` from Phase 2 |
| Device refresh scheduler wiring | [`DashboardCards.svelte`](../../CropWatch/src/lib/components/dashboard/DashboardCards.svelte), [`devices/[dev_eui]/+page.svelte`](../../CropWatch/src/routes/locations/%5Blocation_id%5D/devices/%5Bdev_eui%5D/+page.svelte), [`locations/[location_id]/+page.svelte`](../../CropWatch/src/routes/locations/%5Blocation_id%5D/+page.svelte) | Replaces fixed polling with refetch-on-expiry + backoff; location page gains a live Status column |
| Client-side staff filters removed | [`DeviceOwnerPermissionsCard.svelte`](../../CropWatch/src/routes/locations/%5Blocation_id%5D/devices/%5Bdev_eui%5D/DeviceOwnerPermissionsCard.svelte), [`LocationEditPermissions.svelte`](../../CropWatch/src/routes/locations/%5Blocation_id%5D/settings/LocationEditPermissions.svelte) | Filtering moved into the API (Phase 2) |
| Billing/Stripe UI removed | `src/routes/account/billing/` (deleted), [`Header.svelte`](../../CropWatch/src/routes/Header.svelte), [`api.service.ts`](../../CropWatch/src/lib/api/api.service.ts), `.env` | Stripe is no longer used |
| Discord options removed | [`lib/i18n/options.ts`](../../CropWatch/src/lib/i18n/options.ts), [`reports/ReportTemplateForm.svelte`](../../CropWatch/src/routes/reports/ReportTemplateForm.svelte) | Discord delivery no longer offered |

## Phase 5 — API release B (removal)

Already part of the Phase 0 commit; if you deploy the repo head in Phase 2
this is included — otherwise deploy now. Contents: old `/v1/rules` and
`/v1/reports` modules deleted (`src/v1/rules/`, `src/v1/reports/`,
[`app.module.ts`](../src/app.module.ts)). Must be live only **after** Phase 4,
since the old UI called those endpoints.

> If you deploy everything as one API release (the simple path), do Phase 2
> and Phase 5 together and accept that `/rules`, `/reports` 404 for the short
> window until Phase 4 — only the alert badge and the old rules/reports pages
> are affected.

## Phase 6 — Database lockdown & cleanup (run in this order)

Each script is idempotent and has post-checks at the bottom. Re-run
[`000_preflight_report.sql`](../supabase/updates/000_preflight_report.sql)
after each one and compare.

| # | Script | Why we are changing this |
|---|---|---|
| 6.1 | [`002_enable_rls_all_public.sql`](../supabase/updates/002_enable_rls_all_public.sql) | 23 tables had **no RLS at all** — anyone with the public anon key could read/write them via PostgREST. Enables RLS on every `public` table (no `FORCE`, so owner-run triggers keep working) |
| 6.2 | [`003_drop_legacy_policies.sql`](../supabase/updates/003_drop_legacy_policies.sql) | Drops every anon/authenticated/public policy: the tautological telemetry policies (any signed-in user could read **all** customers' data), `cw_traffic2`'s anonymous INSERT/UPDATE, world-readable `profiles`, and the rest. Data access is API-only (service_role bypasses RLS) |
| 6.3 | [`004_revoke_table_grants.sql`](../supabase/updates/004_revoke_table_grants.sql) | Defense in depth: revokes all table/sequence grants and default privileges from `anon`/`authenticated`, so even a future RLS-disabled table exposes nothing |
| 6.4 | [`005_function_hardening.sql`](../supabase/updates/005_function_hardening.sql) | Pins `search_path` on 11 functions (hijack risk) and revokes EXECUTE on all 15 SECURITY DEFINER functions from API roles — they were callable via `/rest/v1/rpc/` with the anon key (incl. `delete_storage_object`, which embeds a service-role key). Explicitly re-grants `handle_new_user()` to `supabase_auth_admin` so signup keeps working |
| 6.5 | [`006_remove_stripe.sql`](../supabase/updates/006_remove_stripe.sql) | Stripe is no longer used: drops the 3 foreign tables (exposed to the anon key and exempt from RLS), the `stripe_server` FDW server, and the now-unused `wrappers` extension. Foreign tables hold no local data |
| 6.6 | [`007_indexes_and_keys.sql`](../supabase/updates/007_indexes_and_keys.sql) | Performance: drops 5 duplicate index pairs + 1 redundant index (write amplification), adds FK indexes on the hot permission-scoping joins (`cw_device_owners`, `cw_location_owners`, rule/report assignment tables) |
| 6.7 | [`009_remove_discord.sql`](../supabase/updates/009_remove_discord.sql) | Discord is no longer used: reassigns 3 legacy `cw_rules` rows from the discord notifier to email, deletes the Discord rows from `cw_notifier_types` / `communication_methods` (zero recipients reference them), drops `user_discord_connections` (held an exposed `access_token`) |
| 6.8 | Re-run the Supabase **security advisor** (Dashboard → Advisors) | The `rls_disabled_in_public`, `policy_exists_rls_disabled`, `sensitive_columns_exposed`, `*_security_definer_function_executable`, and `foreign_table_in_api` lints must all be clear |

## Phase 7 — Manual verification (after Phases 2–6)

Full script in [`permission-model.md`](./permission-model.md). Summary:

| # | Check | Expected |
|---|---|---|
| 7.1 | Log in, browse dashboard / locations / device pages | Everything loads (app uses the API, not PostgREST) |
| 7.2 | Create a brand-new account | Signup works and a `profiles` row appears (`handle_new_user` survived 005) |
| 7.3 | `curl "https://<project>.supabase.co/rest/v1/cw_devices?select=dev_eui&limit=1" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY"` | `permission denied` — not data |
| 7.4 | Per-role behavior: Admin(1)/Manager(2) manage users + rules/reports; User(3) edits but can't manage; Viewer(4) read-only; Disabled(5) sees nothing | Matches the table in `permission-model.md` |
| 7.5 | As a non-staff user, open location/device user lists | No `@cropwatch.io` rows |
| 7.6 | Move a device between locations (Settings → location) | Ownership transfers to the destination owner, mover shows as Admin, destination members show Disabled, old location users lose access; moving to a location you can't manage is rejected |
| 7.7 | Watch a device pass its upload window on the dashboard (network tab) | Single per-device refetch at expiry; backoff retries while stale; tab-hide pauses; foreground reconciles |
| 7.8 | Visit `/rules`, `/reports`, `/rules-new`, `/reports-new` | Template pages on clean URLs; `-new` URLs redirect; old API routes 404 |
| 7.9 | TTI relay uplink | Accepted with the configured token; rejected without |

## Phase 8 — External credential cleanup

| # | Operation | Why |
|---|---|---|
| 8.1 | Supabase Vault: delete the Stripe API key secret (`SELECT id, name FROM vault.secrets;` then delete) | The wrappers FDW stored it there; nothing uses it now |
| 8.2 | Stripe dashboard: revoke the restricted API key; remove any `PRIVATE_STRIPE_*` env vars from API deployments | Dead credentials should not stay valid |
| 8.3 | Discord developer portal: revoke/delete the CropWatch app or bot | The stored access token (now deleted) was exposed to the anon key while `user_discord_connections` had no RLS |

## Phase 9 — Later / optional

| # | Operation | Why |
|---|---|---|
| 9.1 | [`008_DESTRUCTIVE_legacy_table_drops.sql`](../supabase/updates/008_DESTRUCTIVE_legacy_table_drops.sql) — **fully commented out**; take a backup, uncomment one block at a time | Drops legacy v0 tables (`devices`, `locations`, `permissions`), the empty `*_duplicate` telemetry tables, and eventually the old rules/reports tables. Before dropping `cw_rules`, remove its join in [`devices.service.ts`](../src/v1/devices/devices.service.ts) |
| 9.2 | Supabase dashboard: enable leaked-password protection; upgrade Postgres (17.4 has pending security patches); switch Auth DB connections to percentage-based; confirm "Exposed schemas" | Advisor findings not addressable from SQL |
| 9.3 | Replace the email-suffix staff check with a server-set `app_metadata.role = 'staff'` claim ([`supabase-token.helper.ts`](../src/supabase/supabase-token.helper.ts)) | Documented accepted risk; the claim is more robust than the `@cropwatch.io` suffix |
