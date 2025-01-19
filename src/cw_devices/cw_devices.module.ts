import { Module } from '@nestjs/common';
import { CwDevicesService } from './cw_devices.service';
import { CwDevicesController } from './cw_devices.controller';
import { SupabaseModule } from '../supabase/supabase.module';
import { AuthModule } from '../auth/auth.module';
import { DeviceRepository } from 'src/repositories/cw_devices.repository';

@Module({
  imports: [SupabaseModule, AuthModule],
  providers: [CwDevicesService, DeviceRepository],
  controllers: [CwDevicesController],
  exports: [CwDevicesService],
})
export class CwDevicesModule {}
