import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN_CLIENT, SUPABASE_CLIENT } from './supabase.constants';

@Injectable()
export class SupabaseService {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly client: SupabaseClient,
    @Inject(SUPABASE_ADMIN_CLIENT)
    private readonly adminClient: SupabaseClient | null,
  ) {}

  getClient(): SupabaseClient {
    return this.client;
  }

  getAdminClient(): SupabaseClient | null {
    return this.adminClient ?? null;
  }
}
