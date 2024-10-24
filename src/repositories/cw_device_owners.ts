// src/cw_device_owners/cw_device_owners.repository.ts
import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { Database } from 'database.types';

type DeviceOwnerRow = Database['public']['Tables']['cw_device_owners']['Row'];

@Injectable()
export class DeviceOwnerRepository {
  constructor(private readonly supabaseService: SupabaseService) {}

  async findAll(): Promise<DeviceOwnerRow[]> {
    const { data, error } = await this.supabaseService
      .getSupabaseClient()
      .from('cw_device_owners')
      .select('*');
    if (error) {
      throw error;
    }
    return data || [];
  }

  async findById(id: number): Promise<DeviceOwnerRow | null> {
    const { data, error } = await this.supabaseService
      .getSupabaseClient()
      .from('cw_device_owners')
      .select('*')
      .eq('id', id)
      .single();
    if (error) {
      throw error;
    }
    return data || null;
  }

  async create(deviceOwner: Partial<DeviceOwnerRow>): Promise<DeviceOwnerRow> {
    const { data, error } = await this.supabaseService
      .getSupabaseClient()
      .from('cw_device_owners')
      .insert(deviceOwner)
      .select('*')
      .single();
    if (error) {
      throw error;
    }
    return data;
  }

  async update(id: number, deviceOwner: Partial<DeviceOwnerRow>): Promise<DeviceOwnerRow> {
    const { data, error } = await this.supabaseService
      .getSupabaseClient()
      .from('cw_device_owners')
      .update(deviceOwner)
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
      .from('cw_device_owners')
      .delete()
      .eq('id', id);
    if (error) {
      throw error;
    }
  }
}
