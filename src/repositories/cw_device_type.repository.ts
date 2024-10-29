import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { Database } from 'database.types';
import { BaseRepository } from './base.repository';

type DeviceTypeRow = Database['public']['Tables']['cw_device_type']['Row'];

@Injectable()
export class DeviceTypeRepository extends BaseRepository<DeviceTypeRow> {
    constructor(supabaseService: SupabaseService) {
        super(supabaseService, 'cw_device_type');
    }

    public async findByDeviceType({ dev_type }: { dev_type: string }): Promise<DeviceTypeRow> {
        const { data, error } = await this.supabaseService
            .getSupabaseClient()
            .from('cw_device_type')
            .select('*')
            .eq('dev_type', dev_type)
            .single();
        if (error) {
            throw new Error(`Failed to find device type with dev_type ${dev_type}: ${error.message}`);
        }
        if (!data) {
            throw new Error(`Device type with dev_type ${dev_type} not found.`);
        }
        return data as DeviceTypeRow;
    }
}