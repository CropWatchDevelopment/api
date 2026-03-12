import { BadRequestException, Injectable } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import { TimezoneFormatterService } from '../common/timezone-formatter.service';
import { BaseDataService } from '../common/base-data.service';
import { CreateAirAnnotationDto } from './dto/create-air-annotation.dto';

@Injectable()
export class AirService extends BaseDataService<'cw_air_data'> {
  constructor(
    supabaseService: SupabaseService,
    timezoneFormatter: TimezoneFormatterService,
  ) {
    super(supabaseService, timezoneFormatter, 'cw_air_data');
  }

  async createNote(
    createAirNoteDto: CreateAirAnnotationDto,
    jwtPayload: any,
  ) {
    const normalizedDevEui = createAirNoteDto.dev_eui?.trim();
    if (!normalizedDevEui) {
      throw new BadRequestException('dev_eui is required');
    }
    await this.assertDeviceAccess(normalizedDevEui, jwtPayload);
    const client = this.supabaseService.getClient();

    return client
      .from('cw_air_annotations')
      .insert({
        ...createAirNoteDto,
        dev_eui: normalizedDevEui,
      })
      .select('*')
      .single();
  }
}
