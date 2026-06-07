import { Module } from '@nestjs/common';
import { SupabaseModule } from '../../supabase/supabase.module';
import { DevicesModule } from '../devices/devices.module';
import { LocationsModule } from '../locations/locations.module';
import { ReportsNewController } from './reports-new.controller';
import { ReportsNewService } from './reports-new.service';

@Module({
  imports: [SupabaseModule, DevicesModule, LocationsModule],
  controllers: [ReportsNewController],
  providers: [ReportsNewService],
})
export class ReportsNewModule {}
