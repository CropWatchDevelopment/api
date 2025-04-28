import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { cw_data_metadataRow } from '../common/database-types';
import { createRepository } from './repository-factory';

const BaseDataMetadataRepository = createRepository<cw_data_metadataRow>('cw_data_metadata');

@Injectable()
export class DataMetadataRepository extends BaseDataMetadataRepository {
    constructor(supabaseService: SupabaseService) {
        super(supabaseService);
    }

    public async findByDeviceTypeId({ typeId }: { typeId: number }): Promise<cw_data_metadataRow[]> {
        const { data, error } = await this.supabaseService
            .getSupabaseClient()
            .from('cw_data_metadata')
            .select('*, cw_device_x_cw_data_metadata()')
            .eq('cw_device_x_cw_data_metadata.id', typeId)

        if (error) {
            throw new Error(`Failed to find metadata: ${error.message}`);
        }
        if (!data) {
            throw new Error(`Metadata ${typeId} not found.`);
        }
        return data as cw_data_metadataRow[];
  }
}
