import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { BaseRepository } from './base.repository';
import { LocationRow } from 'src/common/database-types';

@Injectable()
export class LocationRepository extends BaseRepository<LocationRow> {
  constructor(supabaseService: SupabaseService) {
    super(supabaseService, 'cw_locations');
  }
}
