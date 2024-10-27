// src/repositories/base.repository.ts
import { SupabaseService } from '../supabase/supabase.service';

export class BaseRepository<T> {
  constructor(
    protected readonly supabaseService: SupabaseService,
    private readonly tableName: string
  ) {}

  async findAll(): Promise<T[]> {
    const { data, error } = await this.supabaseService
      .getSupabaseClient()
      .from(this.tableName)
      .select('*');
    if (error) {
      throw error;
    }
    return data || [];
  }

  async findById(id: number | string, idColumn = 'id'): Promise<T | null> {
    const { data, error } = await this.supabaseService
      .getSupabaseClient()
      .from(this.tableName)
      .select('*')
      .eq(idColumn, id)
      .single();
    if (error) {
      throw error;
    }
    return data || null;
  }

  async create(item: Partial<T>): Promise<T> {
    const { data, error } = await this.supabaseService
      .getSupabaseClient()
      .from(this.tableName)
      .insert(item)
      .select('*')
      .single();
    if (error) {
      throw error;
    }
    return data;
  }

  async update(id: number | string, item: Partial<T>, idColumn = 'id'): Promise<T> {
    const { data, error } = await this.supabaseService
      .getSupabaseClient()
      .from(this.tableName)
      .update(item)
      .eq(idColumn, id)
      .select('*')
      .single();
    if (error) {
      throw error;
    }
    return data;
  }

  async delete(id: number | string, idColumn = 'id'): Promise<void> {
    const { error } = await this.supabaseService
      .getSupabaseClient()
      .from(this.tableName)
      .delete()
      .eq(idColumn, id);
    if (error) {
      throw error;
    }
  }
}
