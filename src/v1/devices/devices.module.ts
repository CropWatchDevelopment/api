import { Module } from '@nestjs/common';
import { SupabaseModule } from '../../supabase/supabase.module';
import { DevicesService } from './devices.service';
import { DevicesController } from './devices.controller';
import { LocationsService } from '../locations/locations.service';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  // DevicesModule declares its own LocationsService instance, so it must also
  // import PaymentsModule (LocationsService depends on PaymentsService for the
  // base-subscription gate on location creation).
  imports: [SupabaseModule, PaymentsModule],
  controllers: [DevicesController],
  providers: [DevicesService, LocationsService],
  exports: [DevicesService],
})
export class DevicesModule {}
