import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { BaseRepository } from './base.repository';
import { ReportsTemplatesRow } from '../common/database-types';

@Injectable()
export class ReportTemplatesRepository extends BaseRepository<ReportsTemplatesRow> {
    constructor(supabaseService: SupabaseService) {
        super(supabaseService, 'reports_templates');
    }

    public async findByDevEui({ dev_eui }: { dev_eui: string }): Promise<ReportsTemplatesRow> {
        const { data, error } = await this.supabaseService
            .getSupabaseClient()
            .from('reports_templates')
            .select('*')
            .eq('dev_eui', dev_eui)
            .single();
        if (error) {
            throw new Error(`Failed to find device with dev_eui ${dev_eui}: ${error.message}`);
        }
        if (!data) {
            throw new Error(`Device with dev_eui ${dev_eui} not found.`);
        }
        return data;
    }
}
