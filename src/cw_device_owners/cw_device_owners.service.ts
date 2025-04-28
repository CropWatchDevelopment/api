// src/cw_device_owners/cw_device_owners.service.ts
import { Injectable } from '@nestjs/common';
import { CreateDeviceOwnerDto } from './dto/create-device-owner.dto';
import { UpdateDeviceOwnerDto } from './dto/update-device-owner.dto';
import { DeviceOwnerRepository } from '../repositories/cw_device_owners.repository';
import { BaseService } from '../bases/base.service';
import { DeviceOwnerRow } from '../common/database-types';

@Injectable()
export class CwDeviceOwnersService extends BaseService<DeviceOwnerRow, CreateDeviceOwnerDto, UpdateDeviceOwnerDto> {
  constructor(private readonly deviceOwnerRepository: DeviceOwnerRepository) {
    super(deviceOwnerRepository);
  }

  public async getDeviceOwnerByDevEuiAndUID(devEui: string, user_id: string): Promise<DeviceOwnerRow> {
    return this.deviceOwnerRepository.findByDevEuiAndUID(devEui, user_id);
  }
}