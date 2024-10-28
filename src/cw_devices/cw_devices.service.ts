import { Injectable } from '@nestjs/common';
import { Database } from 'database.types';
import { BaseService } from 'src/bases/base.service';
import { CreateDeviceLocationDto } from 'src/cw_device_locations/dto/create-device-location.dto';
import { UpdateDeviceLocationDto } from 'src/cw_device_locations/dto/update-device-location.dto';
import { DeviceRepository } from 'src/repositories/cw_devices.repository';

type DevicesRow = Database['public']['Tables']['cw_devices']['Row'];

@Injectable()
export class CwDevicesService extends BaseService<DevicesRow, CreateDeviceLocationDto, UpdateDeviceLocationDto> {
  constructor(deviceRepository: DeviceRepository) {
    super(deviceRepository);
  }

}
