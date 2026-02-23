import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import { TimezoneFormatterService } from './timezone-formatter.service';
import { TableRow, TableName } from '../types/supabase';

/**
 * Base service class for common data fetching operations across different data types
 */
@Injectable()
export abstract class BaseDataService<T extends TableName> {
  constructor(
    protected readonly supabaseService: SupabaseService,
    protected readonly timezoneFormatter: TimezoneFormatterService,
    protected readonly tableName: T,
  ) {}

  /**
   * Fetches data for a specific device within a date range
   * @param devEui - Device EUI identifier
   * @param startDate - Start date for the query
   * @param endDate - End date for the query
   * @param timezone - Optional timezone for formatting timestamps
   * @returns Array of data rows with formatted timestamps
   */
  async findOne(
    devEui: string,
    startDate: Date,
    endDate: Date,
    timezone?: string,
  ): Promise<TableRow<T>[]> {
    const normalizedTimeZone = timezone?.trim() || null;
    if (normalizedTimeZone) {
      this.timezoneFormatter.assertValidTimeZone(normalizedTimeZone);
    }

    const { data, error } = await this.supabaseService
      .getClient()
      .from(this.tableName)
      .select('*')
      .eq('dev_eui', devEui)
      .gte('created_at', startDate.toISOString())
      .lte('created_at', endDate.toISOString())
      .order('created_at', { ascending: true });

    if (error) {
      throw new InternalServerErrorException(
        `Failed to fetch ${this.tableName} data`,
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return (data ?? []).map((row) => ({
      ...row,
      created_at: this.timezoneFormatter.formatTimestamp(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        row.created_at,
        normalizedTimeZone,
      ),
    }));
  }
}
