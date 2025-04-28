// src/cw_device_owners/cw_device_owners.module.ts
import { Module } from '@nestjs/common';
import { CwDeviceOwnersService } from './cw_device_owners.service';
import { CwDeviceOwnersController } from './cw_device_owners.controller';
import { SupabaseModule } from '../supabase/supabase.module';
import { DeviceOwnerRepository } from '../repositories/cw_device_owners.repository';

@Module({
  imports: [SupabaseModule],
  providers: [CwDeviceOwnersService, DeviceOwnerRepository], // Add repository and service
  controllers: [CwDeviceOwnersController],
  exports: [CwDeviceOwnersService],
})
export class CwDeviceOwnersModule { }
