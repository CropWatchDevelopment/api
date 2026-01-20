import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { TableRow } from '../types/supabase';
import { CreateSoilDto } from './dto/create-soil.dto';
import { UpdateSoilDto } from './dto/update-soil.dto';
import { TimezoneFormatterService } from '../common/timezone-formatter.service';

@Injectable()
export class SoilService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly timezoneFormatter: TimezoneFormatterService,
  ) {}

  create(createSoilDto: CreateSoilDto) {
    return 'This action adds a new soil';
  }

  async findOne(
    devEui: string,
    startDate: Date,
    endDate: Date,
    timezone?: string,
  ): Promise<TableRow<'cw_soil_data'>[]> {
    const normalizedTimeZone = timezone?.trim() || null;
    if (normalizedTimeZone) {
      this.timezoneFormatter.assertValidTimeZone(normalizedTimeZone);
    }

    const { data, error } = await this.supabaseService
      .getClient()
      .from('cw_soil_data')
      .select('*')
      .eq('dev_eui', devEui)
      .gte('created_at', startDate.toISOString())
      .lte('created_at', endDate.toISOString())
      .order('created_at', { ascending: true });

    if (error) {
      throw new InternalServerErrorException('Failed to fetch soil data');
    }

    return (data ?? []).map((row) => ({
      ...row,
      created_at: this.timezoneFormatter.formatTimestamp(row.created_at, normalizedTimeZone),
    }));
  }
}
