import { Module } from '@nestjs/common';
import { SupabaseModule } from '../../supabase/supabase.module';
import { DevicesModule } from '../devices/devices.module';
import { LocationsModule } from '../locations/locations.module';
import { PaymentsModule } from '../payments/payments.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { AuthzModule } from '../common/authz';

@Module({
  imports: [
    SupabaseModule,
    DevicesModule,
    LocationsModule,
    PaymentsModule,
    AuthzModule,
  ],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
