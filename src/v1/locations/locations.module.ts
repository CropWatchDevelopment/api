import { Module } from '@nestjs/common';
import { LocationsService } from './locations.service';
import { LocationsController } from './locations.controller';
import { SupabaseModule } from '../../supabase/supabase.module';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [SupabaseModule, PaymentsModule],
  controllers: [LocationsController],
  providers: [LocationsService],
  exports: [LocationsService],
})
export class LocationsModule {}
