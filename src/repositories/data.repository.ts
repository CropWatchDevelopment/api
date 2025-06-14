// src/data/data.repository.ts
import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import moment from 'moment-timezone';

@Injectable()
export class DataRepository {
  constructor(private readonly supabaseService: SupabaseService) { }

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

    if (data && data.length > 0) {
      return this.convertDataToJapanTimezone(data);
    }

    return [];
  }

  public async findAllByTableAndDateTime<T>(tableName: string, devEui: string, start: Date, end: Date, order: boolean): Promise<T[]> {
    const { data, error } = await this.supabaseService
      .getSupabaseClient()
      .from(tableName)
      .select('*')
      .eq('dev_eui', devEui)
      .gte('created_at', start.toISOString())
      .lte('created_at', end.toISOString())
      .order('created_at', { ascending: order });

    if (error) {
      throw new Error(`Failed to retrieve data from table ${tableName}: ${error.message}`);
    }

    if (data && data.length > 0) {
      return this.convertDataToJapanTimezone(data);
    }

    return [];
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
    
    let result = null;
    result = this.convertDataToJapanTimezone(data);

    return result || null;
  }

  private convertDataToJapanTimezone(data: any[]): any[] {
    return data.map(item => {
      if (item.created_at) {
        item.created_at = moment
          .utc(item.created_at, "YYYY-MM-DD HH:mm:ss.SSSSSSZ")
          .tz("Asia/Tokyo")
          .format("YYYY-MM-DD HH:mm:ss.SSSSSS");
      }
      return item;
    });
  }
}