\# CropWatch API (NestJS)

CropWatch’s REST API, built with NestJS and backed by Supabase.

[![API CI Gate](https://github.com/CropWatchDevelopment/api/actions/workflows/npm-publish.yml/badge.svg)](https://github.com/CropWatchDevelopment/api/actions/workflows/npm-publish.yml)

[![Maintainability](https://qlty.sh/gh/CropWatchDevelopment/projects/api/maintainability.svg)](https://qlty.sh/gh/CropWatchDevelopment/projects/api)


## Quick links

- Landing page (static): `GET /`
- Swagger UI: `GET /docs`

> Note on versioning: Swagger is configured with a base path of `v23` (see `src/main.ts`). In local dev, routes are served at the root (for example `GET /air/:dev_eui`). In production you may be behind a path prefix/rewrite.

## Requirements

- Node.js 20 (CI uses Node 20)
- pnpm (recommended via Corepack)

Enable pnpm via Corepack:

```bash
corepack enable
corepack prepare --activate
```

## Local development

Install dependencies:

```bash
pnpm install
```

Run the API:

```bash
pnpm run start:dev
```

Then open:

- http://localhost:3000/ (landing page)
- http://localhost:3000/docs (Swagger UI)

## Authentication model

Most API endpoints are protected with JWT bearer auth via `JwtAuthGuard`.

1) Get a bearer token:

```bash
curl -sS -X POST \
	http://localhost:3000/auth/login \
	-H 'Content-Type: application/json' \
	-d '{"email":"user@example.com","password":"StrongPassword123!"}'
```

2) Use the returned access token:

```bash
curl -sS \
	http://localhost:3000/devices \
	-H 'Authorization: Bearer YOUR_JWT'
```

### `x-api-key` header

Swagger documents an `x-api-key` header. At the code level, this repository currently advertises the header in Swagger (`addApiKey(...)`) but does not enforce it with a guard/middleware in NestJS. If your deployment requires an API key, enforcement likely happens upstream (edge/proxy) or is planned.

## Resources (high-level)

Routes are defined in the feature controllers under `src/*/*.controller.ts`.

- `auth`
	- `POST /auth/login` – Supabase password login, returns bearer token payload
	- `GET /auth` – returns authenticated user payload (requires bearer)
- `devices`
	- `GET /devices` – list user devices (requires bearer)
	- `GET /devices/:dev_eui` – fetch one device (requires bearer)
- Telemetry (requires bearer)
	- `GET /air/:dev_eui`
	- `GET /soil/:dev_eui`
	- `GET /water/:dev_eui`
	- `GET /traffic/:dev_eui`
	- All support query params `start`, `end` (ISO 8601) and `timezone` (IANA, defaults to `UTC`)
- `power`
	- `GET /power/:id` – placeholder/example (not JWT-protected in the controller)
- Realtime (WebSocket)
	- `src/realtime/realtime.gateway.ts` defines message handlers (Socket.IO)

For the authoritative contract (including DTO shapes), use Swagger at `/docs`.

## Project structure

Each “resource” follows the same Nest module layout:

```
src/<resource>/
	<resource>.module.ts
	<resource>.controller.ts
	<resource>.service.ts
	<resource>.controller.spec.ts
	<resource>.service.spec.ts
	dto/
	entities/
```

Cross-cutting/shared functionality lives under:

- `src/common/` (shared DTOs + shared services like `TimezoneFormatterService`)
- `src/supabase/` (Supabase client providers + `SupabaseService`)
- `src/auth/` (JWT strategy/guard + login flow)

## Adding a new resource (developer workflow)

Use this as the “pit of success” checklist for adding a new feature module.

1) Create the module skeleton

- Create `src/<resource>/` and add:
	- `<resource>.module.ts`
	- `<resource>.controller.ts`
	- `<resource>.service.ts`
	- `dto/` and `entities/` folders as needed

2) Wire it into the app

- Import your module in `src/app.module.ts` (`imports: [...]`).

3) Implement the service (data access)

- If you read/write Supabase, inject `SupabaseService` and use `supabaseService.getClient()`.
- If you return time-series data with timestamps/timezones, prefer `TimezoneFormatterService` (from `src/common/`) instead of duplicating time formatting logic.

4) Implement the controller (HTTP)

- Use `@Controller('<resource>')` for your route prefix.
- Add `@UseGuards(JwtAuthGuard)` for protected endpoints.
- Validate inputs at the boundary (controller):
	- `dev_eui` required
	- `start/end` parseable dates and `start <= end`
	- `timezone` optional, defaults to `UTC`

5) Keep Swagger accurate

- Add `@ApiOkResponse`, `@ApiBadRequestResponse`, etc.
- Use DTOs from `dto/` as `type:` in Swagger decorators.

6) Add tests

- Add/extend unit tests:
	- `<resource>.service.spec.ts` (mock Supabase calls)
	- `<resource>.controller.spec.ts`

Tip: controller specs need providers for constructor-injected dependencies. If your service constructor injects `SupabaseService` and `TimezoneFormatterService`, your controller spec module should provide them (mock `SupabaseService`, real or mock `TimezoneFormatterService`).

7) Run the local quality gate

```bash
pnpm run lint
pnpm run test
pnpm run test:cov
pnpm run build
```

## PR process (how we like to review)

### Branching

- Branch from `master`
- Suggested branch names: `feature/<short-name>`, `fix/<short-name>`, `chore/<short-name>`

### Before opening a PR

- Ensure `pnpm run test:cov` passes locally
- Ensure `pnpm run build` passes
- If you changed an endpoint/DTO, verify `/docs` looks correct

### What CI checks

GitHub Actions runs on pushes to `master` (and on releases) and performs:

- `pnpm install --frozen-lockfile`
- `pnpm run test:cov`
- `pnpm run build`
- Coverage upload to QLTY (requires repo secret `QLTY_COVERAGE_TOKEN`)

Workflow file: `.github/workflows/npm-publish.yml` (named “API CI Gate”).

### PR checklist (review-friendly)

- Clear problem statement + approach in the PR description
- Swagger decorators updated for any API changes
- Tests added/updated for behavior changes
- No new duplicated logic (prefer shared helpers/services under `src/common/`)

