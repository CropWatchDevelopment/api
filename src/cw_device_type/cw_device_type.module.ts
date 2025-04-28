import { Module } from '@nestjs/common';
import { CwDeviceTypeService } from './cw_device_type.service';
import { CwDeviceTypeController } from './cw_device_type.controller';
import { SupabaseModule } from '../supabase/supabase.module';
import { AuthModule } from '../auth/auth.module';
import { DeviceTypeRepository } from '../repositories/cw_device_type.repository';

@Module({
  imports: [SupabaseModule, AuthModule],
  providers: [CwDeviceTypeService, DeviceTypeRepository],
  controllers: [CwDeviceTypeController],
  exports: [CwDeviceTypeService],
})
export class CwDeviceTypeModule {}
