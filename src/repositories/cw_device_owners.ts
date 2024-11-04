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

  public async findByDevEuiAndUID(dev_eui: string, user_id: string): Promise<DeviceOwnerRow> {
    const { data, error } = await this.supabaseService
      .getSupabaseClient()
      .from('cw_device_owners')
      .select('*')
      .eq('dev_eui', dev_eui)
      .eq('user_id', user_id)
      .single();
    if (error) {
      throw new Error(`Failed to find device owner with dev_eui ${dev_eui}: ${error.message}`);
    }
    if (!data) {
      throw new Error(`Device owner with dev_eui ${dev_eui} not found.`);
    }
    return data as DeviceOwnerRow;
  }
}
