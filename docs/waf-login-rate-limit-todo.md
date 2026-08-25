# TODO: Vercel WAF rate limit on `/v1/auth/login` (deferred)

**Status:** Not yet applied — deferred until we're comfortable making firewall
changes on the `api.cropwatch.io` Vercel project. This is config, not code; it
does not ship with the codebase and must be run against Vercel directly.

**Goal:** Stop DoS / brute-force floods against the login endpoint at Vercel's
edge, *before* they reach the function (and before they trigger the expensive
Supabase password check).

## Why the edge, not the app

The app-level throttler (`src/app.module.ts` `ThrottlerModule` +
`src/v1/common/guards/user-throttler.guard.ts`, plus the `@Throttle(2/60)` on
`POST /v1/auth/login` in `src/v1/auth/auth.controller.ts`) is a **backstop, not
a DoS shield**:

- It runs *inside* the function, so a flood still costs an invocation and still
  runs guard code before it can say "no".
- Its counter is in-memory and **per-instance**; Vercel spins up many instances,
  each with its own count, so the real limit is much looser than configured and
  blocks don't propagate.
- It can't stop distributed attacks.

The WAF sits at Vercel's edge: it blocks **before** the function runs, counts
**globally**, and **Vercel does not bill for blocked traffic**. Platform DDoS
mitigation (L3/L4/L7) is already on for free underneath this.

## The nuance for our architecture (read before setting the number)

The WAF rate-limits **by IP**. That's ideal for an attacker (they hit
`api.cropwatch.io/v1/auth/login` directly from their own IP/botnet), but our
**legit** logins arrive from **Vercel's shared egress IPs** — the web app's
SvelteKit server action (`CropWatch/src/lib/server/auth/login-action.ts`) calls
the API server-side. So a too-tight per-IP limit could clip real users clustered
on Vercel IPs. → **Always log first, read real traffic, then enforce.**

Two more, because login is a JSON API (not a browser page):

- Use **`deny` (403)** or **`rate_limit` (429)** when the limit trips — **not
  `challenge`** (an HTML challenge page would break the web app's `fetch` and the
  Android widget, which expect JSON).
- WAF counters are **per-region**, so the effective global limit is ~N× the
  number. Fine for login, just expected.

## Step 0 — prerequisites (in this repo)

```bash
vercel login
vercel link      # link to the api.cropwatch.io project
```

## Step 1 — stage the rule in LOG mode (blocks nothing)

```bash
vercel firewall rules add "Rate limit login" \
  --condition '{"type":"path","op":"eq","value":"/v1/auth/login"}' \
  --condition '{"type":"method","op":"eq","value":"POST"}' \
  --action rate_limit \
  --rate-limit-window 60 \
  --rate-limit-requests 30 \
  --rate-limit-keys ip \
  --rate-limit-action log \
  --yes

vercel firewall diff            # review the staged draft
vercel firewall publish --yes   # make it live (log-only, safe)
```

## Step 2 — watch real traffic for ~a day

Get the rule ID (`rule_…`) from `vercel firewall rules list --json`, then open:

```
https://vercel.com/<team>/<project>/firewall/traffic?filter=<ruleId>
```

Check one thing: **is anything legit exceeding 30/min?**

- Only obvious attackers trip it → proceed to Step 3.
- Real users (clustered Vercel IPs) trip it → raise `--rate-limit-requests`.
- **Zero hits when you actually log in** → the WAF is matching the pre-rewrite
  path. Change the first condition's `"type":"path"` to `"type":"raw_path"` and
  re-publish. (Our `vercel.json` rewrites everything to `/src/main.ts`.)

## Step 3 — enforce

```bash
vercel firewall rules edit "Rate limit login" \
  --rate-limit-action deny \
  --rate-limit-requests 20 \
  --yes
vercel firewall diff && vercel firewall publish --yes
```

If the CLI rejects editing the rate-limit sub-flags, remove and re-add:

```bash
vercel firewall rules remove "Rate limit login" --yes
# then re-run the Step 1 `add` with --rate-limit-action deny
```

Optional: add `--duration 15m` (Pro/Enterprise) so a tripped IP stays blocked
for 15 min instead of resetting each window. Keep the dashboard URL handy for the
first 24h in case a rollback is needed (`--rate-limit-action log` or
`rules disable "Rate limit login"`).

## Optional refinement — zero collateral on legit traffic

To fully separate legit app traffic from attackers: have the web app attach a
**secret header** (server-side only, never in the browser bundle) on its API
calls, and add a higher-priority WAF rule that **`bypass`es** the login rate
limit when that header is present. Then legit app logins are never limited, and
only direct hits (attackers) face the per-IP cap.

- Tradeoff: the Android widget and any direct API callers *would* be subject to
  the limit (fine — low volume, distinct IPs), and there's a shared secret to
  manage. Keep the bypass narrow (secret header **plus** it never appears client
  side).

## Related follow-ups we chose NOT to do in this pass (app-level, code)

If the WAF alone isn't enough later, these are the code-side layers:

- **Per-email login throttle** — key the login throttle on the submitted email
  instead of IP, so legit users on shared Vercel IPs never collide and one
  account can't be brute-forced fast. (Backstop to the WAF.)
- **Per-account failed-attempt lockout / backoff** — defends against distributed
  credential stuffing (one password vs many accounts from many IPs) that IP and
  email limits miss.

## References

- Firewall CLI / WAF: https://vercel.com/docs/cli/firewall ,
  https://vercel.com/docs/vercel-firewall/vercel-waf/custom-rules
- Rate Limiting SDK (for custom counting/buckets):
  https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting-sdk
