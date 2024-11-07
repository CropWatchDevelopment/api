import { Injectable } from '@nestjs/common';
import { SupabaseService } from 'src/supabase/supabase.service';
import { DeviceTypeRow } from 'src/common/database-types';
import { createRepository } from './repository-factory';

const BaseDeviceTypeRepository = createRepository<DeviceTypeRow>('cw_device_type');

@Injectable()
export class DeviceTypeRepository extends BaseDeviceTypeRepository {
    constructor(supabaseService: SupabaseService) {
        super(supabaseService);
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