import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import { TimezoneFormatterService } from './timezone-formatter.service';
import { TableRow, TableName } from '../types/supabase';
import { AccessService, Action } from './authz';
import type { AuthenticatedUser } from '../auth/authenticated-user';

/**
 * Base service class for common data fetching operations across different data types
 */
@Injectable()
export abstract class BaseDataService<T extends TableName> {
  constructor(
    protected readonly supabaseService: SupabaseService,
    protected readonly timezoneFormatter: TimezoneFormatterService,
    protected readonly accessService: AccessService,
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
    user: AuthenticatedUser,
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

    await this.assertDeviceAccess(normalizedDevEui, user);

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

    const rows = (data ?? []) as (TableRow<T> & { created_at: string })[];

    return rows.map((row) => ({
      ...row,
      created_at: this.timezoneFormatter.formatTimestamp(
        row.created_at,
        normalizedTimeZone,
      ),
    }));
  }

  /**
   * Asserts the caller may perform `action` on the device (default: read
   * data). 404 when the device is invisible, 403 when visible but the
   * action is above the caller's level.
   */
  protected async assertDeviceAccess(
    devEui: string,
    user: AuthenticatedUser,
    action: Action = Action.DataRead,
  ): Promise<void> {
    await this.accessService.assertDeviceAccess(user, devEui, action);
  }
}
