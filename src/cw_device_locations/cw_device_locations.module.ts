// src/cw_device_locations/cw_device_locations.module.ts
import { Module } from '@nestjs/common';
import { CwDeviceLocationsService } from './cw_device_locations.service';
import { CwDeviceLocationsController } from './cw_device_locations.controller';
import { SupabaseModule } from '../supabase/supabase.module'; // Import SupabaseModule
import { DeviceLocationRepository } from 'src/repositories/cw_device_locations.repository';

@Module({
  imports: [SupabaseModule],
  providers: [CwDeviceLocationsService, DeviceLocationRepository],
  controllers: [CwDeviceLocationsController],
})
export class CwDeviceLocationsModule {}
