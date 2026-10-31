import { attachReadingAlerts } from './reading-alerts';

// Readings every 10 minutes, newest first (the order the data endpoints use).
// UTC 02:27–03:17 is 11:27–12:17 in Tokyo.
const reading = (time: string) => ({
  created_at: `2026-10-31T${time}:00+00:00`,
});
const ROWS = ['03:17', '03:07', '02:57', '02:47', '02:37', '02:27'].map(
  reading,
);

const FREEZER = 30;
const names = new Map([[FREEZER, 'Freezer too warm']]);

/** Which rows (by their HH:MM) carry an alert. */
const alerted = (rows: ReturnType<typeof attachReadingAlerts>) =>
  rows
    .filter((row) => row.alerts.length > 0)
    .map((row) => String(row.created_at).slice(11, 16));

describe('attachReadingAlerts', () => {
  it('marks every reading from the one that set the rule off through the one that cleared it', () => {
    // Stamped 48 s after the 02:47 and 03:07 readings were processed.
    const trigger = {
      template_id: FREEZER,
      triggered_at: '2026-10-31T02:47:48.127+00:00',
      reset_at: '2026-10-31T03:07:48.194+00:00',
    };

    const rows = attachReadingAlerts(ROWS, [trigger], names);

    expect(alerted(rows)).toEqual(['03:07', '02:57', '02:47']);
    expect(rows[1].alerts).toEqual([
      {
        template_id: FREEZER,
        rule_name: 'Freezer too warm',
        triggered_at: trigger.triggered_at,
        reset_at: trigger.reset_at,
      },
    ]);
    expect(rows[0].alerts).toEqual([]);
    // The reading itself is untouched.
    expect(rows[3]).toMatchObject({ created_at: ROWS[3].created_at });
  });

  it('keeps marking readings while the alarm has not cleared', () => {
    const rows = attachReadingAlerts(
      ROWS,
      [
        {
          template_id: FREEZER,
          triggered_at: '2026-10-31T02:57:30+00:00',
          reset_at: null,
        },
      ],
      names,
    );

    expect(alerted(rows)).toEqual(['03:17', '03:07', '02:57']);
  });

  it('marks the oldest readings of a page when the alarm began before it', () => {
    const rows = attachReadingAlerts(
      ROWS,
      [
        {
          template_id: FREEZER,
          triggered_at: '2026-10-31T01:00:00+00:00',
          reset_at: '2026-10-31T02:37:40+00:00',
        },
      ],
      names,
    );

    expect(alerted(rows)).toEqual(['02:37', '02:27']);
  });

  it('marks the newest reading when its trigger was stamped after it', () => {
    const trigger = {
      template_id: FREEZER,
      triggered_at: '2026-10-31T03:17:50+00:00',
      reset_at: null,
    };

    // No later reading exists (the latest page), or the next one came after the stamp.
    expect(alerted(attachReadingAlerts(ROWS, [trigger], names))).toEqual([
      '03:17',
    ]);
    expect(
      alerted(
        attachReadingAlerts(
          ROWS,
          [trigger],
          names,
          '2026-10-31T03:27:00+00:00',
        ),
      ),
    ).toEqual(['03:17']);
  });

  it("leaves a trigger that belongs to the next page's reading off this page", () => {
    const rows = attachReadingAlerts(
      ROWS,
      [
        {
          template_id: FREEZER,
          triggered_at: '2026-10-31T03:27:48+00:00',
          reset_at: null,
        },
      ],
      names,
      '2026-10-31T03:27:00+00:00',
    );

    expect(alerted(rows)).toEqual([]);
  });

  it('lists every rule a reading was alarming for; a deleted rule has no name', () => {
    const rows = attachReadingAlerts(
      ROWS,
      [
        {
          template_id: FREEZER,
          triggered_at: '2026-10-31T02:47:48+00:00',
          reset_at: '2026-10-31T03:07:48+00:00',
        },
        {
          template_id: 99,
          triggered_at: '2026-10-31T02:57:20+00:00',
          reset_at: '2026-10-31T02:57:59+00:00',
        },
      ],
      names,
    );

    expect(rows[2].alerts.map((alert) => alert.rule_name)).toEqual([
      'Freezer too warm',
      null,
    ]);
    expect(rows[1].alerts).toHaveLength(1);
  });

  it('never marks a reading without a time, and ignores a malformed trigger', () => {
    const rows = attachReadingAlerts(
      [{ created_at: null }, reading('02:47')],
      [
        { template_id: FREEZER, triggered_at: 'not a time', reset_at: null },
        {
          template_id: FREEZER,
          triggered_at: '2026-10-31T02:00:00+00:00',
          reset_at: null,
        },
      ],
      names,
    );

    expect(rows.map((row) => row.alerts.length)).toEqual([0, 1]);
  });

  it('gives every reading an empty list without alarms, and handles no readings', () => {
    expect(
      attachReadingAlerts(ROWS, [], names).every(
        (row) => row.alerts.length === 0,
      ),
    ).toBe(true);
    expect(attachReadingAlerts([], [], names)).toEqual([]);
  });
});
