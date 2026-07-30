# Supabase update scripts

Hand-reviewed SQL scripts for the 2026-06 security hardening effort. **These
are run manually** (SQL editor or `psql`) — they are intentionally *not* in
`supabase/migrations/` so nothing applies them automatically.

Full background: [`docs/security-review.md`](../../docs/security-review.md),
[`docs/permission-model.md`](../../docs/permission-model.md),
[`docs/rls-posture.md`](../../docs/rls-posture.md).

## Run order

| Script | What it does | When |
|---|---|---|
| `000_preflight_report.sql` | Read-only snapshot (RLS, policies, grants, permission levels) | Before & after every other script |
| `001_permission_levels.sql` | 4-level → 5-level permission remap (sentinel-guarded) | **Maintenance window**, immediately before deploying the API release with the new thresholds |
| `002_enable_rls_all_public.sql` | Enables RLS on every `public` table | Any time after the threshold release is live |
| `003_drop_legacy_policies.sql` | Drops all anon/authenticated/public RLS policies | Right after 002 |
| `004_revoke_table_grants.sql` | Revokes anon/authenticated grants + default privileges | Right after 003 |
| `005_function_hardening.sql` | Pins function `search_path`; locks SECURITY DEFINER EXECUTE to service_role | Right after 004 |
| `006_remove_stripe.sql` | Drops the Stripe foreign tables, FDW server, and `wrappers` extension (Stripe is no longer used) | Any time |
| `007_indexes_and_keys.sql` | Drops duplicate indexes, adds FK indexes for hot paths | Any time |
| `008_DESTRUCTIVE_legacy_table_drops.sql` | **Fully commented out.** Legacy table drops | Last, after everything is stable; take a backup first |
| `009_remove_discord.sql` | Drops `user_discord_connections`, removes Discord notifier/communication-method rows (Discord is no longer used) | Any time |
| `010_polar_device_licenses.sql` | Creates `billing_customers` + `device_licenses` for the Polar subscription/licensing feature | Before deploying the Polar API release; regenerate `database.types.ts` after |
| `014_profile_preferences.sql` | Creates `profile_preferences` (1-to-1 with `profiles`) and an `auth.users.email` → `profiles.email` sync trigger for the account preferences + verified email-change feature | Before deploying the profile/preferences API release; regenerate `database.types.ts` after |
| `015_stripe_billing.sql` | Polar → Stripe billing migration: renames `polar_customer_id`/`polar_subscription_id` to `stripe_customer_id`/`stripe_subscription_id` and clears Polar-era cached rows (zero production customers at migration time) | Before deploying the Stripe API release; regenerate `database.types.ts` after |
| `016_report_regeneration_queue.sql` | Creates `cw_report_regeneration_queue` — queue for regenerating report PDFs after note edits (produced by the API, consumed by CW-Reports during its cron runs) | Before deploying the report-notes-edit API release; regenerate `database.types.ts` (api + CropWatch) after |
| `017_line_notifications.sql` | Creates `cw_line_link_nonces` (LINE account-link handshake nonces) + unique partial index on `profiles.line_id` | Before deploying the LINE-linking API release |
| `018_line_action_type.sql` | Seeds `cw_rule_action_types` with the LINE action (id 4) — data-driven rules-UI option | **Last** — only after the alert service with `LineAlertActionHandler` is deployed |
| `019_legal_documents.sql` | Creates `legal_documents` (versioned ToS/EULA/privacy) + `profile_legal_acceptances` (append-only audit), extends `handle_new_user()` to record signup consent (and fixes the first_name/last_name/company metadata mismatch), backfills existing users at v1 | Before deploying the legal re-acceptance API release; regenerate `database.types.ts` (api + CropWatch) after. Publish an update later via the OPS `UPDATE` in the script footer |
| `020_whats_new.sql` | Creates `whats_new` (single-row announcement flag, seeded at release 0) + `profile_whats_new_seen` (per-user dismiss tracking), extends `handle_new_user()` to pre-seed new signups as already-seen | **After 019.** Before deploying the What's New API release; regenerate `database.types.ts` (api + CropWatch) after. Activate an announcement via the OPS `UPDATE` in the script footer, only after the app deploy containing the matching content |
| `021_scheduled_legal_updates.sql` | Creates `legal_document_versions` (published + scheduled versions per document; the current version is the highest one whose `effective_at` has passed, so future-dated inserts activate the re-accept gate on their own, several documents at once when they share an `effective_at`), seeds it from `legal_documents` (which stays as the kind registry, its version columns deprecated), points `handle_new_user()` at it | **After 020.** Run before deploying the scheduled-legal-updates API release; regenerate `database.types.ts` after. Only schedule updates once that release is live — via `scripts/Update-Legal.sql` |

## Deploy/run interleaving (critical)

Permission level numbers **change meaning** in `001` (old `4=Disabled` becomes
`5=Disabled`, old `3=Viewer` becomes `4=Viewer`):

1. Deploy the **additive** API release (triggered endpoints, guards, staff filtering).
2. Maintenance window: run `001`, then **immediately** deploy the API release
   that uses the new thresholds (read `< 5`, manage `<= 2`).
   - Old API + new data fails **closed** (remapped Viewers briefly lose read).
   - New API + old data fails **open** (old Disabled users would gain access) — never that order.
3. Deploy the CropWatch release (5-level dropdowns, route takeover, refresh scheduler).
4. Deploy the API release that removes the old `/v1/rules`, `/v1/reports`, and realtime modules.
5. Run `002`–`007` and `009`. Re-run `000` and compare. Then check the Supabase
   security advisor (Dashboard → Advisors) — the RLS / function lints should be gone.
6. `008` only after a backup, one block at a time.

## Dashboard follow-ups (not scriptable here)

- Auth → enable **leaked password protection** (HaveIBeenPwned).
- Infrastructure → **upgrade Postgres** (17.4 has pending security patches).
- Settings → API → confirm **Exposed schemas** contains only what you serve.
