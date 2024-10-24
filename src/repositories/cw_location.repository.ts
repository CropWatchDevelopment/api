// src/repositories/cw_locations.repository.ts
import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { Database } from 'database.types';  // Adjust the path

type LocationRow = Database['public']['Tables']['cw_locations']['Row'];

@Injectable()
export class LocationRepository {
  constructor(private readonly supabaseService: SupabaseService) {}

  async findAll(): Promise<LocationRow[]> {
    const { data, error } = await this.supabaseService
      .getSupabaseClient()
      .from('cw_locations')
      .select('*');
    if (error) {
      throw error;
    }
    return data || [];
  }

  async findById(id: number): Promise<LocationRow | null> {
    const { data, error } = await this.supabaseService
      .getSupabaseClient()
      .from('cw_locations')
      .select('*')
      .eq('location_id', id)
      .single();
    if (error) {
      throw error;
    }
    return data || null;
  }

  async create(location: Partial<LocationRow>): Promise<LocationRow> {
    const { data, error } = await this.supabaseService
      .getSupabaseClient()
      .from('cw_locations')
      .insert(location)
      .select('*')
      .single();
    if (error) {
      throw error;
    }
    return data;
  }

  async update(id: number, location: Partial<LocationRow>): Promise<LocationRow> {
    const { data, error } = await this.supabaseService
      .getSupabaseClient()
      .from('cw_locations')
      .update(location)
      .eq('location_id', id)
      .select('*')
      .single();
    if (error) {
      throw error;
    }
    return data;
  }

  async delete(id: number): Promise<void> {
    const { error } = await this.supabaseService
      .getSupabaseClient()
      .from('cw_locations')
      .delete()
      .eq('location_id', id);
    if (error) {
      throw error;
    }
  }
}
