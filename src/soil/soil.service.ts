import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { TableRow } from '../types/supabase';
import { CreateSoilDto } from './dto/create-soil.dto';
import { UpdateSoilDto } from './dto/update-soil.dto';
import { getTimeZoneName } from './../helpers/getTimeZoneName';

@Injectable()
export class SoilService {
  constructor(private readonly supabaseService: SupabaseService) {}

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
      this.assertValidTimeZone(normalizedTimeZone);
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
      created_at: this.formatTimestamp(row.created_at, normalizedTimeZone),
    }));
  }

  private assertValidTimeZone(timeZone: string): void {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    } catch (error) {
      throw new BadRequestException('timezone must be a valid IANA time zone');
    }
  }

  private formatTimestamp(value: string, timeZone: string | null): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }

    if (!timeZone) {
      return date.toISOString();
    }

    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(date);

    const byType = new Map(parts.map((part) => [part.type, part.value]));
    const dateTime = `${byType.get('year')}-${byType.get('month')}-${byType.get('day')}T${byType.get('hour')}:${byType.get('minute')}:${byType.get('second')}`;

    return `${dateTime}${this.getTimeZoneOffset(timeZone, date)}`;
  }

  private getTimeZoneOffset(timeZone: string, date: Date): string {

    const tzName = getTimeZoneName(timeZone, date);
    
    const match = tzName.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
    if (!match) {
      return 'Z';
    }

    const sign = match[1] === '-' ? '-' : '+';
    const hours = match[2].padStart(2, '0');
    const minutes = (match[3] ?? '00').padStart(2, '0');

    if (hours === '00' && minutes === '00') {
      return 'Z';
    }

    return `${sign}${hours}:${minutes}`;
  }
}
