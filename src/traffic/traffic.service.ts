import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { CreateTrafficDto } from './dto/create-traffic.dto';
import { UpdateTrafficDto } from './dto/update-traffic.dto';
import { TimezoneFormatterService } from '../common/timezone-formatter.service';
import { BaseDataService } from '../common/base-data.service';

@Injectable()
export class TrafficService extends BaseDataService<'cw_traffic2'> {
  constructor(
    supabaseService: SupabaseService,
    timezoneFormatter: TimezoneFormatterService,
  ) {
    super(supabaseService, timezoneFormatter, 'cw_traffic2');
  }

  create(createTrafficDto: CreateTrafficDto) {
    return 'This action adds a new traffic';
  }

  findAll() {
    return `This action returns all traffic`;
  }

  update(id: number, updateTrafficDto: UpdateTrafficDto) {
    return `This action updates a #${id} traffic`;
  }

  remove(id: number) {
    return `This action removes a #${id} traffic`;
  }
}
