import { SupabaseService } from '../supabase/supabase.service';

/**
 * Base Repository Generic Class.
 * This class is used by all repositories to perform CRUD operations.
 * It is a generic class that accepts a type T.
 * TODO: Prepare this class for mocking, and possibly add failover methods on error, or Round Robbin retry logic.
 * @param {SupabaseService} SupabaseService  The target to process see {@link SupabaseService}
 * @param {string} tableName  The database table name to perform operations
 */
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

  async partialUpdate(id: number | string, item: Partial<T>, idColumn = 'id'): Promise<T> {
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

  async fullUpdate(id: number | string, item: T, idColumn = 'id'): Promise<T> {
    const { data, error } = await this.supabaseService
      .getSupabaseClient()
      .from(this.tableName)
      .update(item) // Accepts full item data
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
