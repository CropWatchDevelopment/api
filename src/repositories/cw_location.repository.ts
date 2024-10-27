import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { Database } from 'database.types';
import { BaseRepository } from './base.repository';

type LocationRow = Database['public']['Tables']['cw_locations']['Row'];

@Injectable()
export class LocationRepository extends BaseRepository<LocationRow> {
  constructor(supabaseService: SupabaseService) {
    super(supabaseService, 'cw_locations');
  }
}
