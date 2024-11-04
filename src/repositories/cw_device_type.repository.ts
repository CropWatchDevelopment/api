import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { BaseRepository } from './base.repository';
import { DeviceTypeRow } from 'src/common/database-types';

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