// src/cw_device_owners/cw_device_owners.repository.ts
import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { Database } from 'database.types';
import { BaseRepository } from './base.repository';

type DeviceOwnerRow = Database['public']['Tables']['cw_device_owners']['Row'];

@Injectable()
export class DeviceOwnerRepository extends BaseRepository<DeviceOwnerRow> {
  constructor(supabaseService: SupabaseService) {
    super(supabaseService, 'cw_device_owners');
  }
}
