import { BadRequestException, Injectable } from '@nestjs/common';
import { getTimeZoneName } from '../helpers/getTimeZoneName';

@Injectable()
export class TimezoneFormatterService {
  assertValidTimeZone(timeZone: string): void {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    } catch {
      throw new BadRequestException('timezone must be a valid IANA time zone');
    }
  }

  formatTimestamp(value: string, timeZone: string | null): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }

    if (!timeZone) {
      return date.toISOString();
    }

    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(date);

    const byType = new Map(parts.map((part) => [part.type, part.value]));
    const dateTime = `${byType.get('year')}-${byType.get('month')}-${byType.get('day')}T${byType.get('hour')}:${byType.get('minute')}:${byType.get('second')}`;

    return `${dateTime}${this.getTimeZoneOffset(timeZone, date)}`;
  }

  /**
   * Converts a local midnight (year/month/day 00:00:00 in the given timezone)
   * to a UTC Date.
   */
  localMidnightToUtc(
    year: number,
    month: number,
    day: number,
    timeZone: string,
  ): Date {
    const guess = new Date(Date.UTC(year, month - 1, day));
    const offsetMs = this.getTimezoneOffsetMs(guess, timeZone);
    return new Date(Date.UTC(year, month - 1, day) - offsetMs);
  }

  /**
   * Returns the local date string (YYYY-MM-DD) for a UTC timestamp in the
   * given timezone.
   */
  toLocalDateString(utcIso: string, timeZone: string): string {
    const date = new Date(utcIso);
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);

    const byType = new Map(parts.map((p) => [p.type, p.value]));
    return `${byType.get('year')}-${byType.get('month')}-${byType.get('day')}`;
  }

  /**
   * Returns the UTC offset in milliseconds for the given timezone at the
   * specified instant (positive = ahead of UTC).
   */
  getTimezoneOffsetMs(instant: Date, timeZone: string): number {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hour12: false,
    }).formatToParts(instant);

    const get = (type: string) =>
      parseInt(parts.find((p) => p.type === type)!.value, 10);

    const localEquiv = Date.UTC(
      get('year'),
      get('month') - 1,
      get('day'),
      get('hour') === 24 ? 0 : get('hour'),
      get('minute'),
      get('second'),
    );

    return localEquiv - instant.getTime();
  }

  private getTimeZoneOffset(timeZone: string, date: Date): string {
    const tzName = getTimeZoneName(timeZone, date);

    const match = tzName.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
    if (!match) {
      return 'Z';
    }

    const sign = match[1] === '-' ? '-' : '+';
    const hours = match[2].padStart(2, '0');
    const minutes = (match[3] ?? '00').padStart(2, '0');

    if (hours === '00' && minutes === '00') {
      return 'Z';
    }

    return `${sign}${hours}:${minutes}`;
  }
}
