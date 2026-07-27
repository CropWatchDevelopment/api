import { Injectable, InternalServerErrorException } from '@nestjs/common';
import type { PostgrestError } from '@supabase/supabase-js';
import { SupabaseService } from '../../supabase/supabase.service';
import { TimezoneFormatterService } from '../common/timezone-formatter.service';
import { BaseDataService } from '../common/base-data.service';
import type { TableRow } from '../types/supabase';
import { TrafficMonthlyReportDto } from './dto/traffic-monthly-report.dto';
import type { AuthenticatedUser } from '../auth/authenticated-user';

type TrafficHourRow = Pick<
  TableRow<'cw_traffic2'>,
  | 'traffic_hour'
  | 'people_count'
  | 'bicycle_count'
  | 'car_count'
  | 'truck_count'
  | 'bus_count'
>;

@Injectable()
export class TrafficService extends BaseDataService<'cw_traffic2'> {
  constructor(
    supabaseService: SupabaseService,
    timezoneFormatter: TimezoneFormatterService,
  ) {
    super(supabaseService, timezoneFormatter, 'cw_traffic2');
  }

  async getMonthlyReport(
    devEui: string,
    year: number,
    month: number,
    user: AuthenticatedUser,
    timezone: string = 'Asia/Tokyo',
  ): Promise<TrafficMonthlyReportDto[]> {
    const tz = timezone || 'Asia/Tokyo';
    this.timezoneFormatter.assertValidTimeZone(tz);
    await this.assertDeviceAccess(devEui, user);

    // Compute month boundaries as UTC timestamps corresponding to local midnight
    const startUtc = this.timezoneFormatter.localMidnightToUtc(
      year,
      month,
      1,
      tz,
    );
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    const endUtc = this.timezoneFormatter.localMidnightToUtc(
      nextYear,
      nextMonth,
      1,
      tz,
    );

    const { data, error } = (await this.supabaseService
      .getClient()
      .from(this.tableName)
      .select(
        'traffic_hour, people_count, bicycle_count, car_count, truck_count, bus_count',
      )
      .eq('dev_eui', devEui)
      .gte('traffic_hour', startUtc.toISOString())
      .lt('traffic_hour', endUtc.toISOString())
      .order('traffic_hour', { ascending: true })) as {
      data: TrafficHourRow[] | null;
      error: PostgrestError | null;
    };

    if (error) {
      throw new InternalServerErrorException(
        'Failed to fetch monthly traffic report',
      );
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
      // traffic_hour is nullable in the schema, but the gte/lt filters above
      // exclude null rows; skip defensively to keep the types honest.
      if (!row.traffic_hour) continue;
      const localDate = this.timezoneFormatter.toLocalDateString(
        row.traffic_hour,
        tz,
      );
      const bucket = dayMap.get(localDate);
      if (bucket) {
        bucket.total_people += row.people_count ?? 0;
        bucket.total_bicycles += row.bicycle_count ?? 0;
        bucket.total_vehicles +=
          (row.car_count ?? 0) + (row.truck_count ?? 0) + (row.bus_count ?? 0);
      }
    }

    return Array.from(dayMap.values());
  }
}
