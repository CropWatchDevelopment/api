# Organizations (PR-B)

The org-aware API layer built on migrations `025_organizations.sql` and
`026_gateways_org.sql`. Full design: the review document
(`CropWatch-Organizations-Permissions-Plan.docx`).

## Model (v1)

- Everything is an organization: `personal` (one full member — its owner)
  or `company`. **One active full membership per person** (owner, manager,
  or member); every other org relationship is a **guest** seat (view-only,
  unlimited, optional expiry).
- Access resolution per request (`src/v1/common/authz/`): staff → org role
  (owner: everything; manager: everything except the owner-only set) →
  parent-org link (read+download on children) → grants (device override,
  else the location default; guests capped at Viewer; suspended members
  and expired guests dormant). Pre-org cross-account shares are
  grandfathered and keep working standalone.
- Money and structure are owner-only: billing, create/delete of
  locations, devices, gateways, and guest management.

## Environment

| Variable | Meaning |
|---|---|
| `ORGS_ENABLED` | `'true'` enables invites, personal→company upgrade, and sub-org link mutations. Anything else hides them as 404s. The authz layer itself is **not** flag-gated. |
| `ORG_OVERLAY_DISABLED` | **Kill-switch.** `'true'` collapses access resolution to grants-only (exact pre-organizations behavior) for every request, without a deploy. Members/managers temporarily lose org-derived access (their grants still apply); flip back off to restore. |
| `APP_PUBLIC_URL` | Base URL for invite links in emails (default `https://app.cropwatch.io`). |
| `SMTP_HOST/PORT/USER/PASS/FROM` | Shared mail transport (`common/mail/MailService`), also used by account-removal. |

## Endpoints

`GET /v1/me/context` — the caller's org + role + capability list (drives
the app's `can()` gating), guest seats, child orgs, `orgs_enabled`.

`/v1/orgs/:orgId` — view/rename/upgrade; `/members` (list respects
visibility rules; edit/suspend/reinstate/remove per plan section 4.3);
`/invites` (7-day sha256-hashed tokens, 50-pending cap, resend rotates);
`/children` + `/parent-requests` (sub-org links).

`/v1/invites/:token` — public throttled preview (masked email);
`/:token/accept` (409 while the caller holds another full membership or a
non-empty personal org).

`/v1/admin/orgs` — staff: search, convert personal→company,
transfer-ownership, link/unlink. This is the conversion tooling for
grouping existing per-user accounts into companies.

## Billing

Billing rows stay keyed by the ORG OWNER's user row until the
constraints migration re-keys the tables. Billing routes are owner-only
(`OrgOwnerGuard`); members/managers read boolean entitlement flags via
`GET /v1/payments/entitlements` only. Stripe checkouts carry
`metadata.org_id` and `client_reference_id = org:<orgId>`; the webhook
resolves org first, then falls back through legacy `user_id`, the local
customer mapping, and Stripe customer metadata — pre-deploy in-flight
checkouts keep working.
