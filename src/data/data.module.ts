import { Module } from '@nestjs/common';
import { DataService } from './data.service';
import { DataController } from './data.controller';
import { CwDeviceTypeService } from 'src/cw_device_type/cw_device_type.service';
import { CwDevicesService } from 'src/cw_devices/cw_devices.service';
import { DataRepository } from 'src/repositories/data.repository';
import { DeviceRepository } from 'src/repositories/cw_devices.repository';
import { DeviceTypeRepository } from 'src/repositories/cw_device_type.repository';
import { SupabaseService } from 'src/supabase/supabase.service';
import { CwDeviceOwnersService } from 'src/cw_device_owners/cw_device_owners.service';
import { DeviceOwnerRepository } from 'src/repositories/cw_device_owners';

@Module({
  imports: [
  ],
  controllers: [DataController],
  providers: [
    DataService,
    DeviceOwnerRepository, //WTF IS THIS???
    CwDevicesService,
    CwDeviceTypeService,
    CwDeviceOwnersService,
    DataRepository,
    DeviceRepository,
    DeviceTypeRepository,
    SupabaseService,
  ],
})
export class DataModule { }
