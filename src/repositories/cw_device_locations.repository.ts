// src/cw_device_locations/cw_device_locations.repository.ts
import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { Database } from 'database.types';  // Adjust the path to your generated types

type DeviceLocationRow = Database['public']['Tables']['cw_device_locations']['Row'];

@Injectable()
export class DeviceLocationRepository {
  constructor(private readonly supabaseService: SupabaseService) {}

  async findAll(): Promise<DeviceLocationRow[]> {
    const { data, error } = await this.supabaseService
      .getSupabaseClient()
      .from('cw_device_locations')
      .select('*');
    if (error) {
      throw error;
    }
    return data || [];
  }

  async findById(id: number): Promise<DeviceLocationRow | null> {
    const { data, error } = await this.supabaseService
      .getSupabaseClient()
      .from('cw_device_locations')
      .select('*')
      .eq('id', id)
      .single();
    if (error) {
      throw error;
    }
    return data || null;
  }

  async create(deviceLocation: Partial<DeviceLocationRow>): Promise<DeviceLocationRow> {
    const { data, error } = await this.supabaseService
      .getSupabaseClient()
      .from('cw_device_locations')
      .insert(deviceLocation)
      .select('*')
      .single();
    if (error) {
      throw error;
    }
    return data;
  }

  async update(id: number, deviceLocation: Partial<DeviceLocationRow>): Promise<DeviceLocationRow> {
    const { data, error } = await this.supabaseService
      .getSupabaseClient()
      .from('cw_device_locations')
      .update(deviceLocation)
      .eq('id', id)
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
      .from('cw_device_locations')
      .delete()
      .eq('id', id);
    if (error) {
      throw error;
    }
  }
}
