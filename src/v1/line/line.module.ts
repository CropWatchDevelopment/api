import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SupabaseModule } from '../../supabase/supabase.module';
import { LineController } from './line.controller';
import { LineService } from './line.service';
import { LineApiClient } from './line-api.client';

@Module({
  imports: [SupabaseModule, ConfigModule],
  controllers: [LineController],
  providers: [LineService, LineApiClient],
  exports: [LineService],
})
export class LineModule {}
