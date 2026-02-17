import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN_CLIENT, SUPABASE_CLIENT } from './supabase.constants';

@Injectable()
export class SupabaseService {
  constructor(
    private readonly configService: ConfigService,
    @Inject(SUPABASE_CLIENT) private readonly client: SupabaseClient,
    @Inject(SUPABASE_ADMIN_CLIENT)
    private readonly adminClient: SupabaseClient | null,
  ) {}

  getClient(accessToken?: string): SupabaseClient {
    if (!accessToken) {
      return this.client;
    }

    const url = this.configService.get<string>('PRIVATE_SUPABASE_URL');
    const anonKey = this.configService.get<string>('PRIVATE_SUPABASE_ANON_KEY');
    if (!url || !anonKey) {
      throw new Error('PRIVATE_SUPABASE_URL and PRIVATE_SUPABASE_ANON_KEY are required');
    }

    return createClient(url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    });
  }

  getAdminClient(): SupabaseClient | null {
    return this.adminClient ?? null;
  }
}
