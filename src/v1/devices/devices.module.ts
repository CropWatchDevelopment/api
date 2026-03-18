import { Module } from '@nestjs/common';
import { SupabaseModule } from '../../supabase/supabase.module';
import { DevicesService } from './devices.service';
import { DevicesController } from './devices.controller';
import { LocationsService } from '../locations/locations.service';

@Module({
  imports: [SupabaseModule],
  controllers: [DevicesController],
  providers: [DevicesService, LocationsService],
})
export class DevicesModule {}
