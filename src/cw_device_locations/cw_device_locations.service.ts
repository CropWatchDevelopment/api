import { Injectable } from '@nestjs/common';
import { CreateDeviceLocationDto } from './dto/create-device-location.dto';
import { UpdateDeviceLocationDto } from './dto/update-device-location.dto';

import { DeviceLocationRepository } from '../repositories/cw_device_locations.repository';
import { BaseService } from 'src/bases/base.service';
import { Database } from 'database.types';

type DeviceLocationRow = Database['public']['Tables']['cw_device_locations']['Row'];

@Injectable()
export class CwDeviceLocationsService extends BaseService<DeviceLocationRow, CreateDeviceLocationDto, UpdateDeviceLocationDto> {
  constructor(deviceLocationRepository: DeviceLocationRepository) {
    super(deviceLocationRepository);
  }
}