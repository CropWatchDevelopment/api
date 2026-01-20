import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { TableRow } from '../types/supabase';
import { CreateTrafficDto } from './dto/create-traffic.dto';
import { UpdateTrafficDto } from './dto/update-traffic.dto';
import { TimezoneFormatterService } from '../common/timezone-formatter.service';

@Injectable()
export class TrafficService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly timezoneFormatter: TimezoneFormatterService,
  ) {}

  create(createTrafficDto: CreateTrafficDto) {
    return 'This action adds a new traffic';
  }

  findAll() {
    return `This action returns all traffic`;
  }

  async findOne(
    devEui: string,
    startDate: Date,
    endDate: Date,
    timezone?: string,
  ): Promise<TableRow<'cw_traffic2'>[]> {
    const normalizedTimeZone = timezone?.trim() || null;
    if (normalizedTimeZone) {
      this.timezoneFormatter.assertValidTimeZone(normalizedTimeZone);
    }

    const { data, error } = await this.supabaseService
      .getClient()
      .from('cw_traffic2')
      .select('*')
      .eq('dev_eui', devEui)
      .gte('created_at', startDate.toISOString())
      .lte('created_at', endDate.toISOString())
      .order('created_at', { ascending: true });

    if (error) {
      throw new InternalServerErrorException('Failed to fetch traffic data');
    }

    return (data ?? []).map((row) => ({
      ...row,
      created_at: this.timezoneFormatter.formatTimestamp(row.created_at, normalizedTimeZone),
    }));
  }

  update(id: number, updateTrafficDto: UpdateTrafficDto) {
    return `This action updates a #${id} traffic`;
  }

  remove(id: number) {
    return `This action removes a #${id} traffic`;
  }

}
