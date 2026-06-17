import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PolarService } from './polar.service';
import { SupabaseModule } from '../../supabase/supabase.module';

@Module({
  imports: [SupabaseModule, ConfigModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, PolarService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
