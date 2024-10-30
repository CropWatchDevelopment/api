// src/cw_devices/cw_devices.repository.ts
import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { Database } from 'database.types';  // Adjust the path to your generated types

type DeviceRow = Database['public']['Tables']['cw_devices']['Row'];

@Injectable()
export class DeviceRepository {
  constructor(private readonly supabaseService: SupabaseService) {
    console.log('DeviceRepository created');
  }

  async findAll(token: string): Promise<DeviceRow[]> {
    const { data: user, error: userError } = await this.supabaseService.getSupabaseClient().auth.getUser(token.replace('Bearer ', ''));
    if (userError) {
      throw userError;
    }
    if (!user) {
      throw new Error('User not found');
    }
    const { data, error } = await this.supabaseService
      .getSupabaseClient()
      .from('cw_devices')
      .select('*, cw_device_owners(*)')
      .eq('cw_device_owners.user_id', user.user.id)
      ;
    if (error) {
      throw error;
    }
    return data || [];
  }

  async findById(id: number, token: string): Promise<DeviceRow | null> {
    const { data, error } = await this.supabaseService
      .getSupabaseClient()
      .from('cw_devices')
      .select('*')
      .eq('id', id)
      .single();
    if (error) {
      throw error;
    }
    return data || null;
  }

  async create(device: Partial<DeviceRow>, token: string): Promise<DeviceRow> {
    const { data, error } = await this.supabaseService
      .getSupabaseClient()
      .from('cw_devices')
      .insert(device)
      .select('*')
      .single();
    if (error) {
      throw error;
    }
    return data;
  }

  async update(id: number, device: Partial<DeviceRow>, token: string): Promise<DeviceRow> {
    const { data, error } = await this.supabaseService
      .getSupabaseClient()
      .from('cw_devices')
      .update(device)
      .eq('id', id)
      .select('*')
      .single();
    if (error) {
      throw error;
    }
    return data;
  }

  async delete(id: number, token: string): Promise<void> {
    const { error } = await this.supabaseService
      .getSupabaseClient()
      .from('cw_devices')
      .delete()
      .eq('id', id);
    if (error) {
      throw error;
    }
  }
}
