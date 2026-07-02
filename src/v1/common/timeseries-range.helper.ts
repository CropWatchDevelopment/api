import { BadRequestException } from '@nestjs/common';

export interface TimeseriesRange {
  startDate: Date;
  endDate: Date;
}

/**
 * Parses the start/end query params shared by the time-series endpoints
 * (air, soil, water, traffic). end defaults to now; start defaults to
 * 24 hours before end.
 */
export function parseTimeseriesRange(
  start?: string,
  end?: string,
): TimeseriesRange {
  const endDate = end ? new Date(end) : new Date();
  if (Number.isNaN(endDate.getTime())) {
    throw new BadRequestException('end must be a valid date/time');
  }

  const startDate = start
    ? new Date(start)
    : new Date(endDate.getTime() - 24 * 60 * 60 * 1000);
  if (Number.isNaN(startDate.getTime())) {
    throw new BadRequestException('start must be a valid date/time');
  }
  if (startDate > endDate) {
    throw new BadRequestException('start must be before end');
  }

  return { startDate, endDate };
}
