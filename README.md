# CropWatch API

[![API CI Gate](https://github.com/CropWatchDevelopment/api/actions/workflows/ci.yml/badge.svg)](https://github.com/CropWatchDevelopment/api/actions/workflows/ci.yml)
[![Security](https://github.com/CropWatchDevelopment/api/actions/workflows/security.yml/badge.svg)](https://github.com/CropWatchDevelopment/api/actions/workflows/security.yml)
[![Vulnerabilities](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2FCropWatchDevelopment%2Fapi%2Fbadges%2Fsnyk.json&logo=snyk)](https://github.com/CropWatchDevelopment/api/actions/workflows/security.yml)
[![Snyk security](https://snyk.io/test/github/CropWatchDevelopment/api/badge.svg)](https://snyk.io/test/github/CropWatchDevelopment/api)
[![Maintainability](https://qlty.sh/gh/CropWatchDevelopment/projects/api/maintainability.svg)](https://qlty.sh/gh/CropWatchDevelopment/projects/api)
[![Code Coverage](https://qlty.sh/gh/CropWatchDevelopment/projects/api/coverage.svg)](https://qlty.sh/gh/CropWatchDevelopment/projects/api)

This is the backend behind [app.cropwatch.io](https://app.cropwatch.io). It serves sensor data from CropWatch's LoRaWAN devices (air, soil, water, traffic counters and relays), manages locations, gateways, alert rules and reports, and handles accounts, organizations and Stripe billing. It also receives webhooks from LINE, The Things Industries and Stripe, and runs an MCP server so AI assistants can read a user's devices with that user's permissions.

It's a NestJS 11 app written in TypeScript, with Supabase (Postgres and auth) as the data store.

## Running it locally

You need Node.js 24 (the version CI and Vercel use) and pnpm. The repo pins pnpm through the `packageManager` field, so Corepack picks the right version:

```bash
corepack enable
pnpm install
pnpm run start:dev
```

The server listens on port 3000 unless `PORT` says otherwise. Two pages are useful once it's up:

- http://localhost:3000/ is the landing page
- http://localhost:3000/docs is the Swagger UI, with the raw spec at `/docs-json` and `/docs-yaml`

### Configuration

Settings come from a `.env` file in the repo root. There's no `.env.example` yet, so here are the variables the code reads, grouped by what needs them:

| Area                             | Variables                                                                                                                                                                                                            |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supabase (required)              | `PRIVATE_SUPABASE_URL`, `PRIVATE_SUPABASE_ANON_KEY`, `PRIVATE_SUPABASE_SERVICE_ROLE_KEY`, `PRIVATE_SUPABASE_JWT_SECRET`                                                                                              |
| Email (invites, account removal) | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`                                                                                                                                                      |
| The Things Industries            | `PRIVATE_TTI_API_KEY`, `PRIVATE_TTI_BASE_URL`, `PRIVATE_TTI_IDENTITY_BASE_URL`, `PRIVATE_TTI_CLUSTER_BASE_URLS`, `PRIVATE_TTI_DEFAULT_APPLICATION_ID`, `PRIVATE_TTI_REQUEST_TIMEOUT_MS`, `PRIVATE_TTI_WEBHOOK_TOKEN` |
| Stripe                           | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_DEVICE_PRICE_ID`, `STRIPE_CHECKOUT_SUCCESS_URL`, `STRIPE_CHECKOUT_CANCEL_URL`, `STRIPE_BILLING_RETURN_URL`                                                     |
| LINE                             | `LINE_CHANNEL_ID`, `LINE_CHANNEL_SECRET`                                                                                                                                                                             |
| Other                            | `APP_PUBLIC_URL`, `PORT`, `ORGS_ENABLED`, `ORG_OVERLAY_DISABLED`, `COMMIT_SHA`                                                                                                                                       |

Only Supabase is needed to boot. A missing integration fails at the point of use: the LINE webhook rejects requests without `LINE_CHANNEL_SECRET`, for example, and email returns "Email delivery is not configured" without SMTP settings. For email, use Gmail: `smtp.gmail.com`, port 465, and an App Password for the sending mailbox (the same setup as Supabase Auth and the alert service).

## Calling the API

Every route is versioned in the URL, so devices live at `/v1/devices`, rules at `/v1/rules`, and so on. Swagger at `/docs` is the full contract, including request and response shapes.

Requests carry a Supabase access token as a bearer token:

```bash
curl -s http://localhost:3000/v1/devices \
  -H "Authorization: Bearer $TOKEN"
```

To get a token, sign in through the app, or call `POST /v1/auth/login` with an email and password.

The MCP server is at `/v1/mcp` (streamable HTTP) and takes the same bearer token. Its tools only return what that user is allowed to see.

## Code layout

Features live under `src/v1/<feature>/`, each with a module, controller, service and specs:

- Sensor data: `air`, `soil`, `water`, `traffic`, `relay`
- Places and hardware: `locations`, `devices` (including `devices/setup`), `gateway`, `dashboard`
- Alerts and reporting: `rules`, `reports`, `push`, `line`
- Accounts and billing: `auth`, `organizations`, `payments`, `account-removal`
- Integrations: `tti` (device provisioning), `mcp`

Shared code sits in `src/v1/common`. That includes `common/authz`, which scopes queries to what the signed-in user may see, and the mail service. The Supabase client is in `src/supabase`.

The landing page served at `/` is a small Svelte app in `web/`. It builds into `static/`, which is committed, so the API doesn't need a frontend build step:

```bash
cd web && pnpm install && pnpm run build
```

## Tests and checks

These are the same steps the CI gate runs, so a green local run should mean a green PR:

```bash
pnpm run lint:check
pnpm run test:cov
pnpm run build
```

`test:cov` runs the whole suite. Run it in full after renaming anything: `src/v1/common/v1-route-input-contract.spec.ts` mocks every controller's services by method name, and a stale name only shows up there.

## CI, security and deployment

Two GitHub Actions workflows run on pushes and pull requests to `master` and `develop`:

- **API CI Gate** (`ci.yml`) lints, tests with coverage, builds, and uploads coverage to Qlty.
- **Security** (`security.yml`) runs `snyk test` on both lockfiles and `snyk code test` on the source. It also runs every morning at 06:17 JST, so an advisory published overnight turns the badge red even if nobody pushed. It fails on any dependency issue or any high or medium code finding. Low code findings are hardcoded values in test fixtures and are reported without failing the job. On `master` it writes the count to `snyk.json` on the `badges` branch, which the Vulnerabilities badge reads.

The Security workflow needs a `SNYK_TOKEN` repository secret. Accepted risks live in `.snyk` with a reason and an expiry date; the `deepmerge` ignores expire on 2027-01-14 and need a fresh look then.

Vercel deploys the API. Pushes to both `develop` and `master` currently create production deployments, so treat a push to `develop` as a release. The `badges` branch is excluded in `vercel.json`.

## Contributing

Branch from `develop`, open a pull request, and keep it reviewable:

- say what problem the change solves and how
- update the Swagger decorators for any endpoint or DTO change, then check `/docs`
- add or update tests for behaviour changes
- reuse helpers in `src/v1/common` instead of copying logic, and route data access through `common/authz`
