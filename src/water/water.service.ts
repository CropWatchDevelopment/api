import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { TableRow } from '../types/supabase';
// import { CreateWaterDto } from './dto/create-water.dto';
// import { UpdateWaterDto } from './dto/update-water.dto';
import { TimezoneFormatterService } from '../common/timezone-formatter.service';

@Injectable()
export class WaterService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly timezoneFormatter: TimezoneFormatterService,
  ) { }

  // create(createWaterDto: CreateWaterDto) {
  //   return 'This action adds a new water';
  // }

  async findOne(
    devEui: string,
    startDate: Date,
    endDate: Date,
    timezone?: string,
  ): Promise<TableRow<'cw_water_data'>[]> {
    const normalizedTimeZone = timezone?.trim() || null;
    if (normalizedTimeZone) {
      this.timezoneFormatter.assertValidTimeZone(normalizedTimeZone);
    }

    const { data, error } = await this.supabaseService
      .getClient()
      .from('cw_water_data')
      .select('*')
      .eq('dev_eui', devEui)
      .gte('created_at', startDate.toISOString())
      .lte('created_at', endDate.toISOString())
      .order('created_at', { ascending: true });

    if (error) {
      throw new InternalServerErrorException('Failed to fetch water data');
    }

    return (data ?? []).map((row) => ({
      ...row,
      created_at: this.timezoneFormatter.formatTimestamp(row.created_at, normalizedTimeZone),
    }));
  }
}
