import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { Database } from 'database.types';
import { BaseRepository } from './base.repository';

type DeviceLocationRow = Database['public']['Tables']['cw_device_locations']['Row'];

@Injectable()
export class DeviceLocationRepository extends BaseRepository<DeviceLocationRow> {
  constructor(supabaseService: SupabaseService) {
    super(supabaseService, 'cw_device_locations');
  }
}
