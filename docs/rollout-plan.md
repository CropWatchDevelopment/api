# Rollout plan: security hardening, permission model v2, device refresh

Status as of 2026-06-12. All code work is **complete and verified** in the three
repos (working trees, not yet committed/deployed). This file is the summary
checklist; the **step-by-step operations runbook with links to every file and
SQL script is [`runbook.md`](./runbook.md)**. Background docs: [`security-review.md`](./security-review.md),
[`permission-model.md`](./permission-model.md), [`rls-posture.md`](./rls-posture.md),
[`device-refresh.md`](./device-refresh.md), and
[`../supabase/updates/README.md`](../supabase/updates/README.md).

## What changed (already implemented)

### api (NestJS)
- `src/v1/common/permission-levels.ts` — single source of truth for the
  5-level model (1=Admin, 2=Manager, 3=User, 4=Viewer, 5=Disabled; read `< 5`,
  manage `<= 2`). Every threshold literal across devices/locations/dashboard/
  relay/rules-new/reports-new services, controllers, and DTO validators now
  uses it.
- `JwtAuthGuard` added to the power controller; unauthenticated realtime
  WebSocket module deleted; TTI relay webhook fails **closed** when
  `PRIVATE_TTI_WEBHOOK_TOKEN` is unset.
- `src/v1/common/owner-filter.helper.ts` — @cropwatch.io owner rows are
  filtered **server-side** out of `GET /locations/:id` for non-staff users.
- `GET /v1/rules-new/triggered` + `/triggered/count` added (badge-compatible);
  old `/v1/rules` and `/v1/reports` modules **removed**.
- **Stripe removed entirely**: `src/v1/payments/` module deleted (Stripe is no
  longer used); contract spec and Swagger doc strings cleaned up.
- **Discord removed**: only reference was a DTO doc string (updated); DB
  removal in `009_remove_discord.sql`.
- **Device moves are now a hand-over** (`updateDevice`): mover must manage
  the destination location; device ownership transfers to the destination
  location's owner; old permission rows are wiped; destination members get
  Disabled rows and the mover gets Admin. Spec section in
  `permission-model.md`, unit tests in `devices.service.spec.ts`.
- SQL scripts in `supabase/updates/` (000–009) + docs in `docs/`.
- Verified: `pnpm test` green, `pnpm build` clean.

### CWUI (component library) — version 0.1.106
- New `src/lib/utils/cwDeviceRefresh.ts`: per-device refetch-on-expiry
  scheduler (lastSeen + upload_interval + grace, jitter, capped exponential
  backoff 1→2→4→8→10 min, in-flight guard, pause/resume on tab visibility),
  built on the existing min-heap alarm scheduler. Exported from the package
  index with full types.
- vitest + happy-dom added; 14 unit tests with fake timers.
- Verified: `pnpm test` 14/14, `svelte-check` 0 errors, package build clean.

### CropWatch (web app)
- Refresh scheduler wired into the dashboard (replaces the 10-min poll,
  patches cards in place), device detail page (replaces its `setInterval`),
  and the location page (previously never refreshed; gained a live Status
  column).
- Rules/reports **route takeover**: template pages now own `/rules` and
  `/reports`; old pages deleted; 301 redirects from `/rules-new` &
  `/reports-new`; sidebar de-duplicated; old API methods + `.env` endpoint
  pins removed; triggered badge reads `/rules-new/triggered`.
- 5-level permission dropdowns/labels (en + ja), `Disabled` fallbacks 4→5,
  thresholds via `src/lib/constants/permissions.ts`, client-side
  @cropwatch.io filters removed (now server-side).
- **Stripe removed**: `/account/billing` route deleted, billing menu entry
  removed from the header, payments methods/constants removed from
  `api.service.ts`, `PUBLIC_STRIPE_CHECKOUT_SESSION_ENDPOINT` removed from
  `.env`, billing i18n keys pruned.
- **Discord removed**: dead rule notifier/send-method option helpers deleted,
  Discord dropped from the report communication-method fallback, related
  i18n keys pruned.
- `@cropwatchdevelopment/cwui` bumped to `0.1.106` in package.json.
  **Local note:** `node_modules/@cropwatchdevelopment/cwui` is currently a
  symlink to `../CWUI` so local builds work before the package is published;
  `pnpm install` after publishing replaces it.
- Verified: vitest 67/67, `svelte-check` 0 errors, production build clean.

## Execution checklist (order is load-bearing)

1. [ ] Commit/PR the three repos (api, CWUI, CropWatch).
2. [ ] Set `PRIVATE_TTI_WEBHOOK_TOKEN` in the API environment (and configure
       the same token on the TTI webhook) — without it the relay webhook
       rejects all uplinks after deploy.
3. [ ] Publish CWUI `0.1.106` (release script), then `pnpm install` in
       CropWatch (replaces the local symlink).
4. [ ] Run `supabase/updates/000_preflight_report.sql`; keep the output.
5. [ ] **Maintenance window:** run `001_permission_levels.sql`, then
       immediately deploy the API release.
       - Never run the new API against un-remapped data: old `Disabled=4`
         users would gain Viewer access (fails open).
       - Old API + new data merely fails closed (remapped Viewers briefly
         lose read) — acceptable for a short window.
6. [ ] Deploy CropWatch (5-level dropdowns, route takeover, refresh
       scheduler). Keep the window between 5 and 6 short: the old UI's
       "Disabled" dropdown writes 4, which now means Viewer.
7. [ ] Run `002`–`007` and `009` (RLS enable, policy drops, grant revokes,
       function hardening, Stripe FDW/server/extension drop, indexes,
       Discord removal). Re-run `000` and compare; check the Supabase
       security advisor — RLS/function lints must clear.
8. [ ] Manual smoke test (script in `permission-model.md`): per-role behavior
       (Viewer read-only, Disabled invisible, Manager can manage
       rules/reports), anon-key PostgREST read returns permission denied,
       login + signup still work, staff rows hidden from non-staff,
       dashboard refetch-on-expiry/backoff visible in the network tab,
       `/rules` & `/reports` land on template pages and old endpoints 404.
9. [ ] Supabase dashboard follow-ups: enable leaked-password protection,
       upgrade Postgres (17.4 has pending security patches), verify
       "Exposed schemas", switch Auth pool to percentage-based.
10. [ ] Later, after stability: `008_DESTRUCTIVE_legacy_table_drops.sql`
        (backup first, one block at a time). Note: remove the `cw_rules` join
        in `devices.service.ts` before dropping `cw_rules`.
11. [ ] After `009`: revoke the CropWatch app/bot in the Discord developer
        portal (the stored access token was exposed to the anon key until
        002/004/009 ran).
12. [ ] After `006`: delete the Stripe API key from Supabase Vault and revoke
        it in the Stripe dashboard; remove any Stripe/payments env vars from
        API deployments.

## Accepted risks / future work
- Staff bypass stays email-suffix (`endsWith('@cropwatch.io')`), centralized
  in `supabase-token.helper.ts`; future: server-set `app_metadata.role`
  claim.
- Old DTO types (`RuleDto` etc.) remain in CropWatch `api.dtos.ts` where
  still referenced by display interfaces; prune opportunistically.
