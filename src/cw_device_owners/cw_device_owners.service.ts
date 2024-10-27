// src/cw_device_owners/cw_device_owners.service.ts
import { Injectable } from '@nestjs/common';
import { CreateDeviceOwnerDto } from './dto/create-device-owner.dto';
import { UpdateDeviceOwnerDto } from './dto/update-device-owner.dto';
import { DeviceOwnerRepository } from 'src/repositories/cw_device_owners';
import { Database } from 'database.types';
import { BaseService } from 'src/bases/base.service';

type DeviceOwnerRow = Database['public']['Tables']['cw_device_owners']['Row'];

@Injectable()
export class CwDeviceOwnersService extends BaseService<DeviceOwnerRow, CreateDeviceOwnerDto, UpdateDeviceOwnerDto> {
  constructor(deviceOwnerRepository: DeviceOwnerRepository) {
    super(deviceOwnerRepository);
  }
}