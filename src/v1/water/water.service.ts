import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import { TimezoneFormatterService } from '../common/timezone-formatter.service';
import { BaseDataService } from '../common/base-data.service';
import { AccessService } from '../common/authz';

@Injectable()
export class WaterService extends BaseDataService<'cw_water_data'> {
  constructor(
    supabaseService: SupabaseService,
    timezoneFormatter: TimezoneFormatterService,
    accessService: AccessService,
  ) {
    super(supabaseService, timezoneFormatter, accessService, 'cw_water_data');
  }
}
