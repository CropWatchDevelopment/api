// src/cw_device_locations/cw_device_locations.service.ts
import { Injectable } from '@nestjs/common';
import { Database } from 'database.types';
import { BaseService } from 'src/bases/base.service';
import { CreateDeviceOwnerDto } from 'src/cw_device_owners/dto/create-device-owner.dto';
import { UpdateDeviceOwnerDto } from 'src/cw_device_owners/dto/update-device-owner.dto';
import { DeviceOwnerRepository } from 'src/repositories/cw_device_owners';

type DeviceOwnerRow = Database['public']['Tables']['cw_device_owners']['Row'];

@Injectable()
export class CwDeviceOwnersService extends BaseService<DeviceOwnerRow, CreateDeviceOwnerDto, UpdateDeviceOwnerDto> {
  constructor(deviceOwnerRepository: DeviceOwnerRepository) {
    super(deviceOwnerRepository);
  }
}