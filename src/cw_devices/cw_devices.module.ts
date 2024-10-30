import { Module } from '@nestjs/common';
import { CwDevicesService } from './cw_devices.service';
import { CwDevicesController } from './cw_devices.controller';
import { SupabaseModule } from '../supabase/supabase.module'; // Import SupabaseModule
import { DeviceRepository } from 'src/repositories/cw_devices.repository';


@Module({
  imports: [SupabaseModule],  // Ensure JwtAuthGuard is NOT in imports
  providers: [CwDevicesService, DeviceRepository],  // Add JwtAuthGuard here
  controllers: [CwDevicesController],
})
export class CwDevicesModule { }