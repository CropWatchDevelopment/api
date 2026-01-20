import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { TimezoneFormatterService } from '../common/timezone-formatter.service';
import { BaseDataService } from '../common/base-data.service';

@Injectable()
export class WaterService extends BaseDataService<'cw_water_data'> {
  constructor(
    supabaseService: SupabaseService,
    timezoneFormatter: TimezoneFormatterService,
  ) {
    super(supabaseService, timezoneFormatter, 'cw_water_data');
  }
}
