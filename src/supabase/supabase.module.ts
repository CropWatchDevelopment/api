import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN_CLIENT, SUPABASE_CLIENT } from './supabase.constants';
import { SupabaseService } from './supabase.service';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: SUPABASE_CLIENT,
      inject: [ConfigService],
      useFactory: (configService: ConfigService): SupabaseClient => {
        const url = configService.get<string>('PRIVATE_SUPABASE_URL');
        const anonKey = configService.get<string>('PRIVATE_SUPABASE_ANON_KEY');
        if (!url || !anonKey) {
          throw new Error(
            'PRIVATE_SUPABASE_URL and PRIVATE_SUPABASE_ANON_KEY are required',
          );
        }
        return createClient(url, anonKey, {
          auth: { autoRefreshToken: false, persistSession: false },
        });
      },
    },
    {
      provide: SUPABASE_ADMIN_CLIENT,
      inject: [ConfigService],
      useFactory: (configService: ConfigService): SupabaseClient | null => {
        const url = configService.get<string>('PRIVATE_SUPABASE_URL');
        const serviceRoleKey = configService.get<string>(
          'PRIVATE_SUPABASE_SERVICE_ROLE_KEY',
        );
        if (!url || !serviceRoleKey) {
          return null;
        }
        return createClient(url, serviceRoleKey, {
          auth: { autoRefreshToken: false, persistSession: false },
        });
      },
    },
    SupabaseService,
  ],
  exports: [SUPABASE_CLIENT, SUPABASE_ADMIN_CLIENT, SupabaseService],
})
export class SupabaseModule {}
