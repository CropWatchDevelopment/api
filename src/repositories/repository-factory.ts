// src/repositories/base-repository-factory.ts
import { SupabaseService } from '../supabase/supabase.service';
import { BaseRepository } from './base.repository';

export function createRepository<T>(tableName: string): new (supabaseService: SupabaseService) => BaseRepository<T> {
  return class extends BaseRepository<T> {
    constructor(supabaseService: SupabaseService) {
      super(supabaseService, tableName);
    }
  };
}
