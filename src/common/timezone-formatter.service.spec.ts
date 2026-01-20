import { BadRequestException } from '@nestjs/common';
import { TimezoneFormatterService } from './timezone-formatter.service';

describe('TimezoneFormatterService', () => {
  let service: TimezoneFormatterService;

  beforeEach(() => {
    service = new TimezoneFormatterService();
  });

  it('returns original value for invalid date input', () => {
    const value = 'not-a-date';
    expect(service.formatTimestamp(value, 'UTC')).toBe(value);
  });

  it('returns ISO string when no timezone is provided', () => {
    const value = '2024-01-01T00:00:00Z';
    expect(service.formatTimestamp(value, null)).toBe(new Date(value).toISOString());
  });

  it('throws for invalid timezone', () => {
    expect(() => service.assertValidTimeZone('Not/AZone')).toThrow(BadRequestException);
  });
});
