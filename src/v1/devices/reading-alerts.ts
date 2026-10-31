/*
 * The rule alerts a device was in at each of its readings.
 *
 * The alert service logs one cw_rule_trigger_log row per alarm: triggered_at
 * when a reading set a rule off, reset_at when a later reading cleared it.
 * Both are stamped when that reading was processed — seconds, at most a few
 * minutes, after the reading's own created_at. So an alarm covers every
 * reading from the latest one at or before triggered_at through the latest
 * one at or before reset_at: the reading that set it off and the one that
 * cleared it included. An alarm that has not cleared covers every later
 * reading.
 */

/** One alarm a reading falls in. */
export interface ReadingAlert {
  template_id: number;
  /** null when the rule has since been deleted. */
  rule_name: string | null;
  triggered_at: string;
  reset_at: string | null;
}

export interface TriggerLogEntry {
  template_id: number;
  triggered_at: string;
  reset_at: string | null;
}

/**
 * The longest a trigger is stamped after its reading. Production shows
 * about 30 s typically and 9.4 min at most (2026-10, air sensors).
 */
export const TRIGGER_LAG_MS = 15 * 60 * 1000;

/**
 * Each row with the alarms it falls in (`alerts`, [] for none). `rows` must
 * be a contiguous run of the device's readings (one page of them).
 * `nextReadingAt` is the device's first reading after the newest row, when
 * there is one: a trigger stamped after that reading belongs to it, not to
 * this page.
 */
export function attachReadingAlerts<T extends Record<string, unknown>>(
  rows: T[],
  triggers: TriggerLogEntry[],
  ruleNames: ReadonlyMap<number, string>,
  nextReadingAt: string | null = null,
): Array<T & { alerts: ReadingAlert[] }> {
  const times = rows.map((row) => Date.parse(String(row.created_at)));
  const known = times.filter(Number.isFinite);
  const newest = known.length > 0 ? Math.max(...known) : -Infinity;
  const nextReading = nextReadingAt ? Date.parse(nextReadingAt) : Infinity;

  const alarms = triggers.flatMap((trigger) => {
    const triggeredAt = Date.parse(trigger.triggered_at);
    if (!Number.isFinite(triggeredAt)) return [];
    if (triggeredAt > newest && nextReading <= triggeredAt) return [];

    // The reading that set it off: the latest one at or before the stamp
    // (earlier than every row here when the alarm began before this page).
    const start = known.reduce(
      (latest, time) => (time <= triggeredAt && time > latest ? time : latest),
      -Infinity,
    );
    const end = trigger.reset_at ? Date.parse(trigger.reset_at) : Infinity;
    const alert: ReadingAlert = {
      template_id: trigger.template_id,
      rule_name: ruleNames.get(trigger.template_id) ?? null,
      triggered_at: trigger.triggered_at,
      reset_at: trigger.reset_at,
    };
    return [{ start, end, alert }];
  });

  return rows.map((row, index) => {
    const time = times[index];
    return {
      ...row,
      alerts: Number.isFinite(time)
        ? alarms
            .filter(({ start, end }) => start <= time && time <= end)
            .map(({ alert }) => alert)
        : [],
    };
  });
}
