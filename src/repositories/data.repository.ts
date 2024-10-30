// src/data/data.repository.ts
import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class DataRepository {
  constructor(private readonly supabaseService: SupabaseService) {}

  public async findAllByTable<T>(tableName: string, devEui: string, skip: number, take: number, order: boolean): Promise<T[]> {
    const { data, error } = await this.supabaseService
      .getSupabaseClient()
      .from(tableName)
      .select('*')
      .eq('dev_eui', devEui)
      .range(skip, skip + take - 1)
      .order('created_at', { ascending: order });

    if (error) {
      throw new Error(`Failed to retrieve data from table ${tableName}: ${error.message}`);
    }

    return data || [];
  }

  public async findByIdInTable<T>(tableName: string, id: number): Promise<T | null> {
    const { data, error } = await this.supabaseService
      .getSupabaseClient()
      .from(tableName)
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      throw new Error(`Failed to find record with id ${id} in table ${tableName}: ${error.message}`);
    }

    return data || null;
  }
}
