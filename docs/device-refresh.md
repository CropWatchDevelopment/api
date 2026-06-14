# Device refresh: refetch on expiry

## Problem

Devices report on a per-device cadence (`cw_devices.upload_interval`, minutes;
default 15). The UI previously used fixed-interval polling (dashboard: every
10 minutes; device detail: every `upload_interval`), so a card could sit
"offline" for up to 10 minutes after the device had actually reported, and
devices with long intervals were polled pointlessly often (or vice versa).

## Design

A single shared scheduler per page, implemented in CWUI
(`src/lib/utils/cwDeviceRefresh.svelte.ts`, Svelte 5 runes module) on top of
the existing min-heap alarm scheduler (`cwAlarmContext.svelte.ts` — one
`setTimeout` for any number of devices) and the freshness helpers in
`utils/cwTimeout.ts`.

### Behavior per device

```
expected next upload = lastSeenAt + uploadInterval
refetch at           = expected next upload + grace (60s) + jitter (0–15s)
```

- **On fire** → state `checking`, call the page-supplied `fetcher(devEui)`
  (CropWatch uses `GET /v1/dashboard/devices/:dev_eui/latest`; `204` → null).
- **Fresh data** (`lastSeenAt` strictly newer) → `onData` patches the row
  in place, state `fresh`, backoff resets, next refetch scheduled from the
  new `lastSeenAt`.
- **Still stale** → state `stale` (cards show offline), retry with exponential
  backoff: 1 min → 2 → 4 → 8 → capped at 10 min, each with jitter.
- **Jitter** prevents a thundering herd when many devices at a location share
  an interval and reported in the same uplink window.
- **In-flight guard**: a device never has two concurrent fetches.

### Lifecycle

- `pause()` on `document.hidden`; `resume()` on visibility/foreground
  recomputes due times and fires overdue devices (staggered by jitter) — this
  fixes the classic "tab slept through its setInterval" staleness.
- SSR-safe: timers no-op without a `document`; everything starts on mount.
- `destroy()` cancels all alarms (component unmount).

### Public API (CWUI)

```ts
createCwDeviceRefreshScheduler(options: CwDeviceRefreshOptions): CwDeviceRefreshScheduler

interface CwDeviceRefreshOptions {
  fetcher: (id: string) => Promise<CwDeviceRefreshResult | null>;
  onData?: (id: string, result: CwDeviceRefreshResult) => void;
  onStateChange?: (id: string, state: CwDeviceFreshness) => void; // 'fresh'|'checking'|'stale'
  graceMs?, jitterMaxMs?, backoffBaseMs?, backoffFactor?, backoffMaxMs?,
  defaultIntervalMinutes?, now?  // all optional, sensible defaults
}

interface CwDeviceRefreshScheduler {
  track(entry): void; trackAll(entries): void;   // upsert + (re)schedule
  reportData(id, lastSeenAt): void;              // external fetch landed
  refreshNow(id?): Promise<void>;                // manual / on-expiry kick
  untrack(id): void; pause(): void; resume(): void; destroy(): void;
  readonly states: ReadonlyMap<string, CwDeviceFreshness>;  // reactive
  readonly size: number;
}

attachCwDeviceRefreshVisibility(scheduler): () => void  // visibilitychange wiring
```

## Consumers (CropWatch)

| Page | Before | After |
|---|---|---|
| Dashboard (`DashboardCards.svelte`) | 10-min `setInterval` full-page refetch | scheduler tracks every visible device; `onData` reuses the in-place patch by `dev_eui`; foreground → `resume()` |
| Device detail (`[dev_eui]/+page.svelte`) | `setInterval` at `upload_interval` | scheduler tracks the one device; fetcher reuses `refreshDisplayedData()` |
| Location page (`[location_id]/+page.svelte`) | no refresh at all | scheduler tracks the location's devices |

`CwSensorCard` needs no changes: it already derives online/offline from
`lastSeenAt`/`expireAfterMinutes` via its own alarm; the scheduler updates the
props, the card reacts. Its `onWithinTimeoutChange(false)` callback is wired
to `scheduler.refreshNow(devEui)` so visual expiry and refetch can't drift
apart.

`upload_interval` is a Postgres `numeric` and arrives as a **string** over
JSON — consumers normalize with `Number(...)` + finiteness check (same
footgun documented in the device detail page) before passing
`uploadIntervalMinutes`.
