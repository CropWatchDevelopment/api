import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import { CreateTrafficDto } from './dto/create-traffic.dto';
import { UpdateTrafficDto } from './dto/update-traffic.dto';
import { TimezoneFormatterService } from '../common/timezone-formatter.service';
import { BaseDataService } from '../common/base-data.service';
import { TrafficMonthlyReportDto } from './dto/traffic-monthly-report.dto';

@Injectable()
export class TrafficService extends BaseDataService<'cw_traffic2'> {
  constructor(
    supabaseService: SupabaseService,
    timezoneFormatter: TimezoneFormatterService,
  ) {
    super(supabaseService, timezoneFormatter, 'cw_traffic2');
  }

  create(createTrafficDto: CreateTrafficDto) {
    return 'This action adds a new traffic';
  }

  findAll() {
    return `This action returns all traffic`;
  }

  update(id: number, updateTrafficDto: UpdateTrafficDto) {
    return `This action updates a #${id} traffic`;
  }

  remove(id: number) {
    return `This action removes a #${id} traffic`;
  }

  async getMonthlyReport(
    devEui: string,
    year: number,
    month: number,
    jwtPayload: any,
    timezone: string = 'Asia/Tokyo',
  ): Promise<TrafficMonthlyReportDto[]> {
    const tz = timezone || 'Asia/Tokyo';
    this.timezoneFormatter.assertValidTimeZone(tz);
    await this.assertDeviceAccess(devEui, jwtPayload);

    // Compute month boundaries as UTC timestamps corresponding to local midnight
    const startUtc = this.localMidnightToUtc(year, month, 1, tz);
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    const endUtc = this.localMidnightToUtc(nextYear, nextMonth, 1, tz);

    const { data, error } = await this.supabaseService
      .getClient()
      .from(this.tableName)
      .select('traffic_hour, people_count, bicycle_count, car_count, truck_count, bus_count')
      .eq('dev_eui', devEui)
      .gte('traffic_hour', startUtc.toISOString())
      .lt('traffic_hour', endUtc.toISOString())
      .order('traffic_hour', { ascending: true });

    if (error) {
      throw new InternalServerErrorException('Failed to fetch monthly traffic report');
    }

    // Build a map of all days in the month initialised to zero
    const dayMap = new Map<string, TrafficMonthlyReportDto>();
    const daysInMonth = new Date(year, month, 0).getDate();
    for (let d = 1; d <= daysInMonth; d++) {
      const dayStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      dayMap.set(dayStr, {
        traffic_day: dayStr,
        total_people: 0,
        total_bicycles: 0,
        total_vehicles: 0,
      });
    }

    // Aggregate each row into its local date bucket
    for (const row of data ?? []) {
      const localDate = this.toLocalDateString(row.traffic_hour, tz);
      const bucket = dayMap.get(localDate);
      if (bucket) {
        bucket.total_people += row.people_count ?? 0;
        bucket.total_bicycles += row.bicycle_count ?? 0;
        bucket.total_vehicles += (row.car_count ?? 0) + (row.truck_count ?? 0) + (row.bus_count ?? 0);
      }
    }

    return Array.from(dayMap.values());
  }

  /**
   * Converts a local midnight (year/month/day 00:00:00 in the given timezone)
   * to a UTC Date.
   */
  private localMidnightToUtc(year: number, month: number, day: number, timezone: string): Date {
    const guess = new Date(Date.UTC(year, month - 1, day));
    const offsetMs = this.getTimezoneOffsetMs(guess, timezone);
    return new Date(Date.UTC(year, month - 1, day) - offsetMs);
  }

  /**
   * Returns the local date string (YYYY-MM-DD) for a UTC timestamp in the
   * given timezone.
   */
  private toLocalDateString(utcIso: string, timezone: string): string {
    const date = new Date(utcIso);
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
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
  private getTimezoneOffsetMs(instant: Date, timezone: string): number {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
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
}
