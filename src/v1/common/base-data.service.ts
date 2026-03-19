import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import { TimezoneFormatterService } from './timezone-formatter.service';
import { TableRow, TableName } from '../types/supabase';
import { getUserId, isCropwatchStaff } from '../../supabase/supabase-token.helper';

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
    jwtPayload: any,
    timezone?: string,
  ): Promise<TableRow<T>[]> {
    const normalizedDevEui = devEui?.trim();
    if (!normalizedDevEui) {
      throw new BadRequestException('dev_eui is required');
    }
    const normalizedTimeZone = timezone?.trim() || null;
    if (normalizedTimeZone) {
      this.timezoneFormatter.assertValidTimeZone(normalizedTimeZone);
    }

    await this.assertDeviceAccess(normalizedDevEui, jwtPayload);

    const { data, error } = await this.supabaseService
      .getClient()
      .from(this.tableName)
      .select('*')
      .eq('dev_eui', normalizedDevEui)
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

  protected async assertDeviceAccess(
    devEui: string,
    jwtPayload: any,
  ): Promise<void> {
    const userId = getUserId(jwtPayload);
    const isGlobalUser = isCropwatchStaff(jwtPayload);
    let query = this.supabaseService
      .getClient()
      .from('cw_devices')
      .select('dev_eui, owner_match:cw_device_owners()')
      .eq('dev_eui', devEui);

    if (!isGlobalUser) {
      query = query
        .eq('owner_match.user_id', userId)
        .lt('owner_match.permission_level', 4)
        .or(`user_id.eq.${userId},owner_match.not.is.null`);
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
      throw new InternalServerErrorException('Failed to validate device access');
    }

    if (!data) {
      throw new NotFoundException('Device not found');
    }
  }
}
