import { BadRequestException } from '@nestjs/common';
import {
  normalizeSchedule,
  sameSchedule,
  timeOfDayFromDb,
} from './rule-schedule';

const valid = {
  timeOfDay: '09:00',
  daysOfWeek: [1, 3, 5],
  timezone: 'Asia/Tokyo',
};

describe('normalizeSchedule', () => {
  it('accepts a time, weekdays and an IANA zone', () => {
    expect(normalizeSchedule(valid)).toEqual(valid);
  });

  it('sorts the weekdays, drops repeats and trims', () => {
    expect(
      normalizeSchedule({
        timeOfDay: ' 23:59 ',
        daysOfWeek: [7, 1, 7, 3],
        timezone: ' America/Argentina/Buenos_Aires ',
      }),
    ).toEqual({
      timeOfDay: '23:59',
      daysOfWeek: [1, 3, 7],
      timezone: 'America/Argentina/Buenos_Aires',
    });
  });

  it('accepts UTC', () => {
    expect(normalizeSchedule({ ...valid, timezone: 'UTC' }).timezone).toBe(
      'UTC',
    );
  });

  it.each([undefined, null, 'daily', 7])(
    'refuses %p instead of a schedule',
    (value) => {
      expect(() => normalizeSchedule(value)).toThrow(
        new BadRequestException(
          'A Date/Time rule needs a time, at least one weekday and a time zone',
        ),
      );
    },
  );

  it.each(['9:00', '24:00', '09:60', '09:00:30', '9am', '', 900, undefined])(
    'refuses the time %p',
    (timeOfDay) => {
      expect(() => normalizeSchedule({ ...valid, timeOfDay })).toThrow(
        'The time must be given as HH:mm (24-hour clock)',
      );
    },
  );

  it.each([[[]], [[0]], [[8]], [[1.5]], [['1']], ['1,2'], [undefined]])(
    'refuses the weekdays %p',
    (daysOfWeek) => {
      expect(() => normalizeSchedule({ ...valid, daysOfWeek })).toThrow(
        'Choose at least one weekday (1 = Monday ... 7 = Sunday)',
      );
    },
  );

  // An offset or an abbreviation has no daylight saving rules.
  it.each([
    '+09:00',
    'UTC+9',
    'JST',
    'EST',
    'Tokyo',
    'Asia/Tokio',
    'Mars/Olympus',
    '',
    9,
    undefined,
  ])('refuses the time zone %p', (timezone) => {
    expect(() => normalizeSchedule({ ...valid, timezone })).toThrow(
      'The time zone must be an IANA name such as Asia/Tokyo',
    );
  });
});

describe('sameSchedule', () => {
  it('compares time, zone and weekdays', () => {
    expect(sameSchedule(valid, { ...valid, daysOfWeek: [1, 3, 5] })).toBe(true);
    expect(sameSchedule(valid, { ...valid, timeOfDay: '09:01' })).toBe(false);
    expect(sameSchedule(valid, { ...valid, timezone: 'UTC' })).toBe(false);
    expect(sameSchedule(valid, { ...valid, daysOfWeek: [1, 3] })).toBe(false);
    expect(sameSchedule(valid, { ...valid, daysOfWeek: [1, 3, 6] })).toBe(
      false,
    );
  });
});

describe('timeOfDayFromDb', () => {
  it('drops the seconds of a Postgres time', () => {
    expect(timeOfDayFromDb('09:00:00')).toBe('09:00');
    expect(timeOfDayFromDb('23:59')).toBe('23:59');
  });
});
