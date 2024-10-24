import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import { Database } from 'database.types';  // Ensure the correct path to your types file
import { RepositoryInterface } from 'src/interfaces/repositoryBase.interface';

// Define the type for the `devices` table's rows
type DeviceRow = Database['public']['Tables']['devices']['Row'];

@Injectable()
export class DeviceRepository implements RepositoryInterface<DeviceRow> {
    constructor(private readonly supabaseService: SupabaseService) { }

    async findAll(): Promise<DeviceRow[]> {
        const { data, error } = await this.supabaseService
            .getSupabaseClient()
            .from('devices')
            .select('*');
        if (error) {
            throw error;
        }
        return data || [];
    }

    async findById(id: string): Promise<DeviceRow | null> {
        const { data, error } = await this.supabaseService
            .getSupabaseClient()
            .from('devices')
            .select('*')
            .eq('id', id)
            .single();
        if (error) {
            throw error;
        }
        return data || null;
    }

    async create(entity: DeviceRow): Promise<DeviceRow> {
        const { data, error } = await this.supabaseService
            .getSupabaseClient()
            .from('devices')
            .insert(entity)
            .select('*')
            .single();
        if (error) {
            throw error;
        }
        return data;
    }

    async update(id: string, entity: Partial<DeviceRow>): Promise<DeviceRow> {
        const { data, error } = await this.supabaseService
            .getSupabaseClient()
            .from('devices')
            .update(entity)
            .eq('id', id)
            .select('*')
            .single();
        if (error) {
            throw error;
        }
        return data;
    }

    async delete(id: string): Promise<void> {
        const { error } = await this.supabaseService
            .getSupabaseClient()
            .from('devices')
            .delete()
            .eq('id', id);
        if (error) {
            throw error;
        }
    }
}