import {
  buildRelayHistory,
  evaluateRelayCommand,
  RELAY_CONFIRMATION_WINDOW_MS,
  RELAY_PULSE_COMPLETION_GRACE_MS,
  toRelayCommandRecord,
  type RelayCommandRecord,
  type RelayReportRecord,
} from './relay-history';

const SENT_MS = Date.parse('2026-10-10T11:00:00.000Z');

/** ISO time `seconds` after the first command was sent. */
function at(seconds: number): string {
  return new Date(SENT_MS + seconds * 1000).toISOString();
}

function report(
  id: number,
  seconds: number,
  relay_1: boolean | null,
  relay_2: boolean | null = false,
): RelayReportRecord {
  return { id, reported_at: at(seconds), relay_1, relay_2 };
}

function fixed(
  id: number,
  seconds: number,
  relay: 1 | 2,
  target_state: 'on' | 'off',
): RelayCommandRecord {
  return {
    id,
    sent_at: at(seconds),
    command: 'fixed',
    relay,
    target_state,
    duration_seconds: null,
    requested_by_name: 'Kevin Cantrell',
  };
}

function pulse(
  id: number,
  seconds: number,
  relay: 1 | 2,
  duration_seconds: number,
): RelayCommandRecord {
  return {
    id,
    sent_at: at(seconds),
    command: 'pulse',
    relay,
    target_state: 'on',
    duration_seconds,
    requested_by_name: null,
  };
}

function status(id: number, seconds: number): RelayCommandRecord {
  return {
    id,
    sent_at: at(seconds),
    command: 'status',
    relay: null,
    target_state: null,
    duration_seconds: null,
    requested_by_name: null,
  };
}

const nowAt = (seconds: number) => SENT_MS + seconds * 1000;
const WINDOW_SECONDS = RELAY_CONFIRMATION_WINDOW_MS / 1000;

describe('evaluateRelayCommand', () => {
  it('confirms at the first report after the command that shows the target', () => {
    const reports = [report(1, 4, true)];

    expect(
      evaluateRelayCommand(fixed(1, 0, 1, 'on'), reports, null, nowAt(10)),
    ).toEqual({ outcome: 'confirmed', report: reports[0] });
  });

  it('ignores a report from before or at the moment the command was sent', () => {
    const reports = [report(1, -5, true), report(2, 0, true)];

    expect(
      evaluateRelayCommand(fixed(1, 0, 1, 'on'), reports, null, nowAt(10))
        .outcome,
    ).toBe('pending');
  });

  it('waits through an old-state report and confirms on the report after it', () => {
    const reports = [report(1, 1, false), report(2, 5, true)];

    expect(
      evaluateRelayCommand(fixed(1, 0, 1, 'on'), reports, null, nowAt(10)),
    ).toEqual({ outcome: 'confirmed', report: reports[1] });
  });

  it('turns an old-state report into a mismatch only once the window has passed', () => {
    const reports = [report(1, 4, false)];
    const command = fixed(1, 0, 1, 'on');

    expect(
      evaluateRelayCommand(command, reports, null, nowAt(30)).outcome,
    ).toBe('pending');
    expect(
      evaluateRelayCommand(command, reports, null, nowAt(WINDOW_SECONDS + 1)),
    ).toEqual({ outcome: 'mismatch', report: reports[0] });
  });

  it('keeps the window verdict even if a matching report arrives later, like the relay page', () => {
    const reports = [report(1, 4, false), report(2, 600, true)];

    expect(
      evaluateRelayCommand(fixed(1, 0, 1, 'on'), reports, null, nowAt(700)),
    ).toEqual({ outcome: 'mismatch', report: reports[0] });
  });

  it('lets the first report after a silent window decide', () => {
    const command = fixed(1, 0, 1, 'on');

    expect(
      evaluateRelayCommand(command, [report(1, 600, true)], null, nowAt(700))
        .outcome,
    ).toBe('confirmed');
    expect(
      evaluateRelayCommand(command, [report(1, 600, false)], null, nowAt(700))
        .outcome,
    ).toBe('mismatch');
  });

  it('is pending without a report, then unconfirmed once the window has passed', () => {
    const command = fixed(1, 0, 1, 'off');

    expect(evaluateRelayCommand(command, [], null, nowAt(30))).toEqual({
      outcome: 'pending',
      report: null,
    });
    expect(
      evaluateRelayCommand(command, [], null, nowAt(WINDOW_SECONDS + 1))
        .outcome,
    ).toBe('unconfirmed');
  });

  it('skips reports that do not carry the relay', () => {
    const reports = [report(1, 3, null), report(2, 6, true)];

    expect(
      evaluateRelayCommand(fixed(1, 0, 1, 'on'), reports, null, nowAt(10)),
    ).toEqual({ outcome: 'confirmed', report: reports[1] });
  });

  it('confirms a pulse from a report sent while it was on', () => {
    const reports = [report(1, 4, false, true)];

    expect(
      evaluateRelayCommand(pulse(1, 0, 2, 15), reports, null, nowAt(20)),
    ).toEqual({ outcome: 'confirmed', report: reports[0] });
  });

  it('confirms a pulse from the report the relay sends once it has reverted', () => {
    // Measured on the LT-22222-L: no report when a pulse starts, one ~4 s after it ends.
    const reports = [report(1, 19, false, false)];

    expect(
      evaluateRelayCommand(pulse(1, 0, 2, 15), reports, null, nowAt(25)),
    ).toEqual({ outcome: 'confirmed', report: reports[0] });
  });

  it('lets the completion report win over an off report from before the pulse started', () => {
    const reports = [report(1, 1, false, false), report(2, 19, false, false)];

    expect(
      evaluateRelayCommand(pulse(1, 0, 2, 15), reports, null, nowAt(25)),
    ).toEqual({ outcome: 'confirmed', report: reports[1] });
  });

  it('is pending until the completion report is due, then unconfirmed', () => {
    const command = pulse(1, 0, 2, 15);
    const completionDue = 15 + RELAY_PULSE_COMPLETION_GRACE_MS / 1000;

    expect(
      evaluateRelayCommand(command, [], null, nowAt(completionDue - 1)).outcome,
    ).toBe('pending');
    expect(
      evaluateRelayCommand(command, [], null, nowAt(completionDue + 1)).outcome,
    ).toBe('unconfirmed');
  });

  it('cannot judge a pulse from a scheduled report long after it ended', () => {
    const reports = [report(1, 100, false, false)];

    expect(
      evaluateRelayCommand(pulse(1, 0, 2, 15), reports, null, nowAt(120)),
    ).toEqual({ outcome: 'unconfirmed', report: null });
  });

  it('reports a mismatch when the relay is still on after the pulse', () => {
    const reports = [report(1, 19, false, true)];

    expect(
      evaluateRelayCommand(pulse(1, 0, 2, 15), reports, null, nowAt(25)),
    ).toEqual({ outcome: 'mismatch', report: reports[0] });
  });

  it('reports a mismatch when a short pulse only ever reported off', () => {
    const reports = [report(1, 3, false, false)];

    expect(
      evaluateRelayCommand(pulse(1, 0, 2, 15), reports, null, nowAt(40)),
    ).toEqual({ outcome: 'mismatch', report: reports[0] });
  });

  it('reports a mismatch when a long pulse reports off after the window', () => {
    const reports = [report(1, 300, false)];

    expect(
      evaluateRelayCommand(pulse(1, 0, 1, 600), reports, null, nowAt(400))
        .outcome,
    ).toBe('mismatch');
  });

  it('answers a status request with the first report after it', () => {
    const reports = [report(1, 3, true)];

    expect(
      evaluateRelayCommand(status(1, 0), reports, null, nowAt(10)),
    ).toEqual({ outcome: 'answered', report: reports[0] });
    expect(
      evaluateRelayCommand(status(1, 0), [], null, nowAt(10)).outcome,
    ).toBe('pending');
    expect(
      evaluateRelayCommand(status(1, 0), [], null, nowAt(WINDOW_SECONDS + 1))
        .outcome,
    ).toBe('unconfirmed');
  });
});

describe('buildRelayHistory', () => {
  const range = {
    start: new Date(SENT_MS - 60_000),
    end: new Date(SENT_MS + 3_600_000),
    evaluatedAt: new Date(SENT_MS + 3_600_000),
  };

  it('lists only reports that change a relay, compared with the report before the range', () => {
    const entries = buildRelayHistory({
      ...range,
      baseline: report(1, -600, false, false),
      reports: [
        report(2, 10, false, false), // unchanged
        report(3, 20, true, false), // relay 1 on
        report(4, 30, true, null), // relay 2 unknown: carries forward
        report(5, 40, true, true), // relay 2 on
      ],
      commands: [],
    });

    expect(entries).toEqual([
      {
        id: 'report:5',
        kind: 'state_change',
        at: at(40),
        relay_1: true,
        relay_2: true,
        changed_relays: [2],
      },
      {
        id: 'report:3',
        kind: 'state_change',
        at: at(20),
        relay_1: true,
        relay_2: false,
        changed_relays: [1],
      },
    ]);
  });

  it('treats the first report as the starting point when nothing came before it', () => {
    const entries = buildRelayHistory({
      ...range,
      baseline: null,
      reports: [report(1, 10, true, false), report(2, 20, false, false)],
      commands: [],
    });

    expect(entries.map((entry) => entry.id)).toEqual(['report:2']);
  });

  it('settles commands with reports after the range but does not list those reports', () => {
    const entries = buildRelayHistory({
      start: new Date(SENT_MS - 60_000),
      end: new Date(SENT_MS + 1_000),
      evaluatedAt: new Date(SENT_MS + 3_600_000),
      baseline: report(1, -600, false, false),
      reports: [report(2, 4, true, false)],
      commands: [fixed(7, 0, 1, 'on')],
    });

    expect(entries).toEqual([
      {
        id: 'command:7',
        kind: 'command',
        at: at(0),
        command: 'fixed',
        relay: 1,
        target_state: 'on',
        duration_seconds: null,
        requested_by: 'Kevin Cantrell',
        outcome: 'confirmed',
        settled_at: at(4),
        relay_1: true,
        relay_2: false,
      },
    ]);
  });

  it('hands reports to the newer command when a command on the same relay supersedes one', () => {
    const entries = buildRelayHistory({
      ...range,
      baseline: report(1, -600, false, false),
      reports: [report(2, 14, false, false)],
      commands: [fixed(1, 0, 1, 'on'), fixed(2, 10, 1, 'off')],
    });
    const outcomes = Object.fromEntries(
      entries
        .filter((entry) => entry.kind === 'command')
        .map((entry) => [entry.id, entry.outcome]),
    );

    expect(outcomes).toEqual({
      'command:1': 'unconfirmed',
      'command:2': 'confirmed',
    });
  });

  it('does not let a command on the other relay or a status request supersede', () => {
    const entries = buildRelayHistory({
      ...range,
      baseline: report(1, -600, false, false),
      reports: [report(2, 24, true, true)],
      commands: [fixed(1, 0, 1, 'on'), fixed(2, 5, 2, 'on'), status(3, 20)],
    });
    const outcomes = Object.fromEntries(
      entries
        .filter((entry) => entry.kind === 'command')
        .map((entry) => [entry.id, entry.outcome]),
    );

    expect(outcomes).toEqual({
      'command:1': 'confirmed',
      'command:2': 'confirmed',
      'command:3': 'answered',
    });
  });

  it('lets a command after the range still supersede one inside it', () => {
    const entries = buildRelayHistory({
      start: new Date(SENT_MS - 60_000),
      end: new Date(SENT_MS + 5_000),
      evaluatedAt: new Date(SENT_MS + 3_600_000),
      baseline: null,
      reports: [report(1, 14, false, false)],
      commands: [fixed(1, 0, 1, 'on'), fixed(2, 10, 1, 'off')],
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: 'command:1',
      outcome: 'unconfirmed',
    });
  });

  it('sorts newest first and keeps only the newest entries over the cap', () => {
    const entries = buildRelayHistory({
      ...range,
      baseline: report(1, -600, false, false),
      reports: [report(2, 30, true, false)],
      commands: [fixed(1, 20, 1, 'on'), status(2, 40)],
      maxEntries: 2,
    });

    expect(entries.map((entry) => entry.id)).toEqual(['command:2', 'report:2']);
  });
});

describe('toRelayCommandRecord', () => {
  const row = {
    id: 1,
    sent_at: at(0),
    command: 'fixed',
    relay: 1,
    target_state: 'on',
    duration_seconds: null,
  };

  it('names the requester by full name, then username, never email', () => {
    expect(
      toRelayCommandRecord({
        ...row,
        requester: { full_name: ' Kevin Cantrell ', username: 'kevin' },
      })?.requested_by_name,
    ).toBe('Kevin Cantrell');
    expect(
      toRelayCommandRecord({
        ...row,
        requester: [{ full_name: '  ', username: 'kevin' }],
      })?.requested_by_name,
    ).toBe('kevin');
    expect(
      toRelayCommandRecord({ ...row, requester: null })?.requested_by_name,
    ).toBeNull();
  });

  it('drops rows that are not a valid command', () => {
    expect(toRelayCommandRecord({ ...row, command: 'reboot' })).toBeNull();
    expect(toRelayCommandRecord({ ...row, relay: null })).toBeNull();
    expect(toRelayCommandRecord({ ...row, target_state: 'toggle' })).toBeNull();
    expect(
      toRelayCommandRecord({ ...row, command: 'status', target_state: null }),
    ).toBeNull();
    expect(
      toRelayCommandRecord({
        ...row,
        command: 'status',
        relay: null,
        target_state: null,
      }),
    ).toMatchObject({ command: 'status', relay: null, target_state: null });
  });
});
