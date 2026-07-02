import { Module } from '@nestjs/common';
import { SupabaseModule } from '../../supabase/supabase.module';
import { DevicesModule } from '../devices/devices.module';
import { LocationsModule } from '../locations/locations.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [SupabaseModule, DevicesModule, LocationsModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
