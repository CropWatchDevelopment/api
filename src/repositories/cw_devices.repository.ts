import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { Database } from 'database.types';
import { BaseRepository } from './base.repository';

type DeviceRow = Database['public']['Tables']['cw_devices']['Row'];

@Injectable()
export class DeviceRepository extends BaseRepository<DeviceRow> {
    constructor(supabaseService: SupabaseService) {
        super(supabaseService, 'cw_devices');
    }
}