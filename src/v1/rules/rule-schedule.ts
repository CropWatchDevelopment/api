import { BadRequestException } from '@nestjs/common';

/** When a Date/Time rule runs: a wall-clock time on chosen weekdays, in a time zone. */
export interface RuleSchedule {
  /** HH:mm, 24-hour, in `timezone`. */
  timeOfDay: string;
  /** ISO weekdays, sorted: 1 = Monday ... 7 = Sunday. */
  daysOfWeek: number[];
  /** IANA name, e.g. Asia/Tokyo. */
  timezone: string;
}

const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/;
// "Region/City" (also three-part names), or plain UTC. Never an offset or an
// abbreviation: "+09:00" and "EST" would silently ignore daylight saving time.
const IANA_NAME = /^(UTC|[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)+)$/;

/** HH:mm of a Postgres `time` value ("09:00:00"). */
export function timeOfDayFromDb(value: string): string {
  return value.slice(0, 5);
}

function isKnownTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

/**
 * Checks and tidies a schedule from a request. The database checks the time
 * zone again against its own list (and does all the time-zone math); this
 * turns the common mistakes into a clear message first.
 */
export function normalizeSchedule(value: unknown): RuleSchedule {
  if (!value || typeof value !== 'object') {
    throw new BadRequestException(
      'A Date/Time rule needs a time, at least one weekday and a time zone',
    );
  }
  const input = value as Record<string, unknown>;

  const timeOfDay =
    typeof input.timeOfDay === 'string' ? input.timeOfDay.trim() : '';
  if (!TIME_OF_DAY.test(timeOfDay)) {
    throw new BadRequestException(
      'The time must be given as HH:mm (24-hour clock)',
    );
  }

  const days = Array.isArray(input.daysOfWeek) ? input.daysOfWeek : [];
  if (
    days.length === 0 ||
    days.some(
      (day) =>
        typeof day !== 'number' || !Number.isInteger(day) || day < 1 || day > 7,
    )
  ) {
    throw new BadRequestException(
      'Choose at least one weekday (1 = Monday ... 7 = Sunday)',
    );
  }
  const daysOfWeek = [...new Set(days as number[])].sort((a, b) => a - b);

  const timezone =
    typeof input.timezone === 'string' ? input.timezone.trim() : '';
  if (!IANA_NAME.test(timezone) || !isKnownTimeZone(timezone)) {
    throw new BadRequestException(
      'The time zone must be an IANA name such as Asia/Tokyo',
    );
  }

  return { timeOfDay, daysOfWeek, timezone };
}

export function sameSchedule(a: RuleSchedule, b: RuleSchedule): boolean {
  return (
    a.timeOfDay === b.timeOfDay &&
    a.timezone === b.timezone &&
    a.daysOfWeek.length === b.daysOfWeek.length &&
    a.daysOfWeek.every((day, index) => day === b.daysOfWeek[index])
  );
}
