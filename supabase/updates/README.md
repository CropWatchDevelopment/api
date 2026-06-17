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
