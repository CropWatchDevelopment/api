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

    public async findByDevEui({ dev_eui }: { dev_eui: string }): Promise<DeviceRow> {
        const { data, error } = await this.supabaseService
            .getSupabaseClient()
            .from('cw_devices')
            .select('*')
            .eq('dev_eui', dev_eui)
            .single();
        if (error) {
            throw new Error(`Failed to find device with dev_eui ${dev_eui}: ${error.message}`);
        }
        if (!data) {
            throw new Error(`Device with dev_eui ${dev_eui} not found.`);
        }
        return data as DeviceRow;
    }
}