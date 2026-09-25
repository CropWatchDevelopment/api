import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SupabaseModule } from '../../../supabase/supabase.module';
import { AccessService } from './access.service';

/**
 * Central authorization. Import this module wherever a service needs
 * AccessService; the pure helpers (policy, grant-policy, scope) are plain
 * TS imports from `./index`.
 */
@Module({
  imports: [SupabaseModule, ConfigModule],
  providers: [AccessService],
  exports: [AccessService],
})
export class AuthzModule {}
