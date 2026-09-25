import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SupabaseModule } from '../../supabase/supabase.module';
import { LineController } from './line.controller';
import { LineService } from './line.service';
import { LineApiClient } from './line-api.client';
import { AuthzModule } from '../common/authz';

@Module({
  imports: [SupabaseModule, ConfigModule, AuthzModule],
  controllers: [LineController],
  providers: [LineService, LineApiClient],
  exports: [LineService],
})
export class LineModule {}
