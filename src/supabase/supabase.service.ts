import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN_CLIENT, SUPABASE_CLIENT } from './supabase.constants';

@Injectable()
export class SupabaseService {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly authClient: SupabaseClient,
    @Inject(SUPABASE_ADMIN_CLIENT)
    private readonly adminClient: SupabaseClient,
  ) {}

  // Data operations run through the service-role client so API authorization
  // is enforced in Nest instead of via Supabase RLS.
  getClient(_accessToken?: string): SupabaseClient {
    return this.adminClient;
  }

  getAuthClient(): SupabaseClient {
    return this.authClient;
  }

  getAdminClient(): SupabaseClient {
    return this.adminClient;
  }
}
