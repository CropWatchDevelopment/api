// src/cw_device_owners/cw_device_owners.service.ts
import { Injectable } from '@nestjs/common';
import { CreateDeviceOwnerDto } from './dto/create-device-owner.dto';
import { UpdateDeviceOwnerDto } from './dto/update-device-owner.dto';
import { DeviceOwnerRepository } from 'src/repositories/cw_device_owners';

@Injectable()
export class CwDeviceOwnersService {
  constructor(private readonly deviceOwnerRepository: DeviceOwnerRepository) {}

  async findAll() {
    return this.deviceOwnerRepository.findAll();
  }

  async findById(id: number) {
    return this.deviceOwnerRepository.findById(id);
  }

  async create(createDeviceOwnerDto: CreateDeviceOwnerDto) {
    return this.deviceOwnerRepository.create(createDeviceOwnerDto);
  }

  async update(id: number, updateDeviceOwnerDto: UpdateDeviceOwnerDto) {
    return this.deviceOwnerRepository.update(id, updateDeviceOwnerDto);
  }

  async delete(id: number) {
    return this.deviceOwnerRepository.delete(id);
  }
}
