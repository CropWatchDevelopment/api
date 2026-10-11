import {
  isRelayNumber,
  isRelayTargetState,
  type RelayNumber,
  type RelayTargetState,
} from './relay.types';

/**
 * How long a command is actively confirmed. Keep in sync with
 * RELAY_CONFIRMATION_WINDOW_MS in CropWatch's relay-control.ts: the history
 * must reach the same verdict the user saw on the relay page.
 */
export const RELAY_CONFIRMATION_WINDOW_MS = 60_000;
/**
 * How long after a pulse ends its completion report may arrive. Measured
 * 2026-10-10: the LT-22222-L reports ~4-5 s after a timed command finishes.
 */
export const RELAY_PULSE_COMPLETION_GRACE_MS = 20_000;
/** Most entries one history response returns (the newest are kept). */
export const RELAY_HISTORY_MAX_ENTRIES = 1500;

export type RelayCommandKind = 'fixed' | 'pulse' | 'status';

/**
 * `confirmed`: a report after the command shows the requested state.
 * `mismatch`: the device reported after the command and still shows the old state.
 * `unconfirmed`: no report settled it (device silent, pulse over, or superseded).
 * `pending`: still inside the confirmation window.
 * `answered`: a status request the device replied to.
 */
export type RelayCommandOutcome =
  | 'answered'
  | 'confirmed'
  | 'mismatch'
  | 'pending'
  | 'unconfirmed';

export interface RelayReportRecord {
  id: number;
  reported_at: string;
  relay_1: boolean | null;
  relay_2: boolean | null;
}

export interface RelayCommandRecord {
  id: number;
  sent_at: string;
  command: RelayCommandKind;
  relay: RelayNumber | null;
  target_state: RelayTargetState | null;
  duration_seconds: number | null;
  requested_by_name: string | null;
}

/** A cw_relay_commands row with its `requester:requested_by(...)` embed. */
export interface RelayCommandRow {
  id: number;
  sent_at: string;
  command: string;
  relay: number | null;
  target_state: string | null;
  duration_seconds: number | null;
  requester?: RequesterRow | RequesterRow[] | null;
}

interface RequesterRow {
  full_name: string | null;
  username: string | null;
}

export interface RelayStateChangeEntry {
  id: string;
  kind: 'state_change';
  at: string;
  relay_1: boolean | null;
  relay_2: boolean | null;
  changed_relays: RelayNumber[];
}

export interface RelayCommandEntry {
  id: string;
  kind: 'command';
  at: string;
  command: RelayCommandKind;
  relay: RelayNumber | null;
  target_state: RelayTargetState | null;
  duration_seconds: number | null;
  /** Full name or username of who sent it; never an email. */
  requested_by: string | null;
  outcome: RelayCommandOutcome;
  /** When the report that settled it arrived; null while nothing has. */
  settled_at: string | null;
  /** Relay states in that report. */
  relay_1: boolean | null;
  relay_2: boolean | null;
}

export type RelayHistoryEntry = RelayStateChangeEntry | RelayCommandEntry;

export interface RelayCommandEvaluation {
  outcome: RelayCommandOutcome;
  report: RelayReportRecord | null;
}

export interface BuildRelayHistoryInput {
  /** The last report before `start`: decides whether the first one in range is a change. */
  baseline: RelayReportRecord | null;
  /** Reports from `start` to `evaluatedAt`. */
  reports: RelayReportRecord[];
  /** Commands from `start` to `evaluatedAt`. */
  commands: RelayCommandRecord[];
  start: Date;
  end: Date;
  /** Reports and commands up to here settle outcomes; also "now" for pending ones. */
  evaluatedAt: Date;
  maxEntries?: number;
}

function toMs(value: string): number {
  return Date.parse(value);
}

function toIso(value: string): string {
  return new Date(value).toISOString();
}

function isRelayCommandKind(value: unknown): value is RelayCommandKind {
  return value === 'fixed' || value === 'pulse' || value === 'status';
}

function relayValue(
  report: RelayReportRecord,
  relay: RelayNumber,
): boolean | null {
  return relay === 1 ? report.relay_1 : report.relay_2;
}

function byTimeThenId<T extends { id: number }>(
  timeOf: (row: T) => string,
): (a: T, b: T) => number {
  return (a, b) => toMs(timeOf(a)) - toMs(timeOf(b)) || a.id - b.id;
}

/**
 * Maps a command row for the history. Rows that don't match a known command
 * shape are dropped (the table's CHECK constraint should make that
 * impossible).
 */
export function toRelayCommandRecord(
  row: RelayCommandRow,
): RelayCommandRecord | null {
  const { command, relay, target_state: targetState } = row;
  if (!isRelayCommandKind(command)) {
    return null;
  }

  const isStatus = command === 'status';
  if (isStatus ? relay !== null : !isRelayNumber(relay)) {
    return null;
  }
  if (isStatus ? targetState !== null : !isRelayTargetState(targetState)) {
    return null;
  }

  const requester = Array.isArray(row.requester)
    ? (row.requester[0] ?? null)
    : (row.requester ?? null);

  return {
    id: row.id,
    sent_at: row.sent_at,
    command,
    relay: isRelayNumber(relay) ? relay : null,
    target_state: isRelayTargetState(targetState) ? targetState : null,
    duration_seconds: row.duration_seconds,
    requested_by_name:
      requester?.full_name?.trim() || requester?.username?.trim() || null,
  };
}

/**
 * Decides whether the device confirmed a command, with the relay page's rules
 * (CropWatch relay-control.ts): only reports received after the command count,
 * and a report showing the old state inside the confirmation window may
 * predate the command running, so it only becomes a mismatch when nothing
 * better arrives by the end of the window.
 *
 * @param reportsAsc the device's reports, oldest first
 * @param supersededAtMs when the next fixed/pulse command on the same relay
 *   was sent; reports after it belong to that command
 */
export function evaluateRelayCommand(
  command: RelayCommandRecord,
  reportsAsc: RelayReportRecord[],
  supersededAtMs: number | null,
  nowMs: number,
): RelayCommandEvaluation {
  const sentMs = toMs(command.sent_at);
  const later = reportsAsc.filter(
    (report) => toMs(report.reported_at) > sentMs,
  );

  if (command.command === 'status' || command.relay === null) {
    const [answer] = later;
    if (answer) {
      return { outcome: 'answered', report: answer };
    }

    return {
      outcome:
        nowMs - sentMs < RELAY_CONFIRMATION_WINDOW_MS
          ? 'pending'
          : 'unconfirmed',
      report: null,
    };
  }

  if (command.command === 'pulse') {
    return evaluatePulse(
      command.relay,
      sentMs,
      sentMs + (command.duration_seconds ?? 0) * 1000,
      later,
      supersededAtMs,
      nowMs,
    );
  }

  const relay = command.relay;
  const target = command.target_state === 'on';
  const windowEndsAtMs = sentMs + RELAY_CONFIRMATION_WINDOW_MS;

  let oldStateReport: RelayReportRecord | null = null;
  for (const report of later) {
    const reportedMs = toMs(report.reported_at);
    if (supersededAtMs !== null && reportedMs >= supersededAtMs) {
      break;
    }

    const value = relayValue(report, relay);
    if (value === null) {
      continue;
    }

    if (reportedMs >= windowEndsAtMs && oldStateReport) {
      // The page settled this at the end of the window.
      return { outcome: 'mismatch', report: oldStateReport };
    }
    if (value === target) {
      return { outcome: 'confirmed', report };
    }
    if (reportedMs >= windowEndsAtMs) {
      return { outcome: 'mismatch', report };
    }

    oldStateReport = report;
  }

  const horizonMs = Math.min(nowMs, supersededAtMs ?? Number.POSITIVE_INFINITY);
  if (oldStateReport && horizonMs >= windowEndsAtMs) {
    return { outcome: 'mismatch', report: oldStateReport };
  }

  return {
    outcome:
      horizonMs >= windowEndsAtMs || supersededAtMs !== null
        ? 'unconfirmed'
        : 'pending',
    report: null,
  };
}

/**
 * A pulse turns the relay on and reverts it on its own. The LT-22222-L does
 * not report when a timed command starts; it reports ~4 s after it finishes,
 * with the relay back off. So a pulse is confirmed by a report showing the
 * relay on while it ran (a periodic or status report), or by that completion
 * report.
 */
function evaluatePulse(
  relay: RelayNumber,
  sentMs: number,
  endsAtMs: number,
  later: RelayReportRecord[],
  supersededAtMs: number | null,
  nowMs: number,
): RelayCommandEvaluation {
  const windowEndsAtMs = Math.min(
    sentMs + RELAY_CONFIRMATION_WINDOW_MS,
    endsAtMs,
  );
  const completionDueMs = endsAtMs + RELAY_PULSE_COMPLETION_GRACE_MS;

  let offEarly: RelayReportRecord | null = null;
  for (const report of later) {
    const reportedMs = toMs(report.reported_at);
    if (supersededAtMs !== null && reportedMs >= supersededAtMs) {
      break;
    }

    const value = relayValue(report, relay);
    if (value === null) {
      continue;
    }

    if (reportedMs <= endsAtMs) {
      if (value) {
        return { outcome: 'confirmed', report };
      }
      if (reportedMs >= windowEndsAtMs) {
        return { outcome: 'mismatch', report }; // off while it should run
      }
      offEarly = report; // may predate the pulse starting
      continue;
    }

    if (reportedMs <= completionDueMs) {
      // The completion report: the relay should be back off.
      return { outcome: value ? 'mismatch' : 'confirmed', report };
    }

    break; // a later scheduled report can't tell whether the pulse ran
  }

  const horizonMs = Math.min(nowMs, supersededAtMs ?? Number.POSITIVE_INFINITY);
  if (supersededAtMs === null && horizonMs < completionDueMs) {
    return { outcome: 'pending', report: null };
  }

  return offEarly
    ? { outcome: 'mismatch', report: offEarly }
    : { outcome: 'unconfirmed', report: null };
}

/**
 * Merges a relay's reports and commands into one timeline, newest first:
 * state changes (reports that differ from the one before) and every command
 * with its outcome. Unchanged reports are only used to settle commands.
 */
export function buildRelayHistory(
  input: BuildRelayHistoryInput,
): RelayHistoryEntry[] {
  const startMs = input.start.getTime();
  const endMs = input.end.getTime();
  const nowMs = input.evaluatedAt.getTime();
  const reports = [...input.reports].sort(
    byTimeThenId((report) => report.reported_at),
  );
  const commands = [...input.commands].sort(
    byTimeThenId((command) => command.sent_at),
  );
  const entries: RelayHistoryEntry[] = [];

  let previous: Pick<RelayReportRecord, 'relay_1' | 'relay_2'> | null =
    input.baseline;
  for (const report of reports) {
    const reportedMs = toMs(report.reported_at);
    const before = previous;
    if (before && reportedMs >= startMs && reportedMs <= endMs) {
      const changedRelays = ([1, 2] as const).filter((relay) => {
        const was = relay === 1 ? before.relay_1 : before.relay_2;
        const now = relayValue(report, relay);
        return was !== null && now !== null && was !== now;
      });

      if (changedRelays.length > 0) {
        entries.push({
          id: `report:${report.id}`,
          kind: 'state_change',
          at: toIso(report.reported_at),
          relay_1: report.relay_1 ?? before.relay_1,
          relay_2: report.relay_2 ?? before.relay_2,
          changed_relays: [...changedRelays],
        });
      }
    }

    previous = {
      relay_1: report.relay_1 ?? previous?.relay_1 ?? null,
      relay_2: report.relay_2 ?? previous?.relay_2 ?? null,
    };
  }

  // Status requests never supersede: the page sends them while confirming.
  const supersededAt = new Map<number, number | null>();
  const nextOnRelay = new Map<RelayNumber, number>();
  for (let index = commands.length - 1; index >= 0; index -= 1) {
    const command = commands[index];
    if (command.command === 'status' || command.relay === null) {
      continue;
    }
    supersededAt.set(command.id, nextOnRelay.get(command.relay) ?? null);
    nextOnRelay.set(command.relay, toMs(command.sent_at));
  }

  for (const command of commands) {
    const sentMs = toMs(command.sent_at);
    if (sentMs < startMs || sentMs > endMs) {
      continue;
    }

    const { outcome, report } = evaluateRelayCommand(
      command,
      reports,
      supersededAt.get(command.id) ?? null,
      nowMs,
    );
    entries.push({
      id: `command:${command.id}`,
      kind: 'command',
      at: toIso(command.sent_at),
      command: command.command,
      relay: command.relay,
      target_state: command.target_state,
      duration_seconds: command.duration_seconds,
      requested_by: command.requested_by_name,
      outcome,
      settled_at: report ? toIso(report.reported_at) : null,
      relay_1: report?.relay_1 ?? null,
      relay_2: report?.relay_2 ?? null,
    });
  }

  return entries
    .sort((a, b) => toMs(b.at) - toMs(a.at) || b.id.localeCompare(a.id))
    .slice(0, input.maxEntries ?? RELAY_HISTORY_MAX_ENTRIES);
}
