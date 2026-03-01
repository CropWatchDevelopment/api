import { Controller, Injectable } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import { TimezoneFormatterService } from '../common/timezone-formatter.service';
import { BaseDataService } from '../common/base-data.service';
import { CreateAirAnnotationDto } from './dto/create-air-annotation.dto';
import { getAccessToken, getUserId } from 'src/supabase/supabase-token.helper';

@Injectable()
export class AirService extends BaseDataService<'cw_air_data'> {
  constructor(
    supabaseService: SupabaseService,
    timezoneFormatter: TimezoneFormatterService,
  ) {
    super(supabaseService, timezoneFormatter, 'cw_air_data');
  }

  async createNote(createAirNoteDto: CreateAirAnnotationDto, user: any, authHeader: string) {
    const accessToken = getAccessToken(authHeader);
    const client = this.supabaseService.getClient(accessToken);

    return this.supabaseService
      .getClient()
      .from('cw_air_annotations')
      .insert(createAirNoteDto)
      .select('*')
      .single();
  }
}
