import { Injectable } from '@nestjs/common';
import { SupabaseService } from 'src/supabase/supabase.service';
import { DeviceRow } from 'src/common/database-types';
import { createRepository } from './repository-factory';

const BaseDeviceRepository = createRepository<DeviceRow>('cw_devices');

@Injectable()
export class DeviceRepository extends BaseDeviceRepository {
    constructor(supabaseService: SupabaseService) {
        super(supabaseService);
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
