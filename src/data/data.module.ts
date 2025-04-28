import { Module } from '@nestjs/common';
import { DataService } from './data.service';
import { DataController } from './data.controller';
import { CwDeviceTypeService } from '../cw_device_type/cw_device_type.service';
import { CwDevicesService } from '../cw_devices/cw_devices.service';
import { DataRepository } from '../repositories/data.repository';
import { DeviceRepository } from '../repositories/cw_devices.repository';
import { DeviceTypeRepository } from '../repositories/cw_device_type.repository';
import { SupabaseService } from '../supabase/supabase.service';
import { CwDeviceOwnersService } from '../cw_device_owners/cw_device_owners.service';
import { DeviceOwnerRepository } from '../repositories/cw_device_owners.repository';
import { CwDevicesModule } from '../cw_devices/cw_devices.module';
import { CwDeviceTypeModule } from '../cw_device_type/cw_device_type.module';
import { CwDeviceOwnersModule } from '../cw_device_owners/cw_device_owners.module';

@Module({
  imports: [
    CwDevicesModule,
    CwDeviceTypeModule,
    CwDeviceOwnersModule,
  ],
  controllers: [DataController],
  providers: [
    DataService,
    DataRepository,
    SupabaseService,
  ],
  exports: [
    DataService,
    DataRepository,
  ]
})
export class DataModule {}
