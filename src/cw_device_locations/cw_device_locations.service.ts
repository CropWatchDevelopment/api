// src/cw_device_locations/cw_device_locations.service.ts
import { Injectable } from '@nestjs/common';
import { CreateDeviceLocationDto } from './dto/create-device-location.dto';
import { UpdateDeviceLocationDto } from './dto/update-device-location.dto';
import { DeviceLocationRepository } from 'src/repositories/cw_device_locations.repository';

@Injectable()
export class CwDeviceLocationsService {
  constructor(private readonly deviceLocationRepository: DeviceLocationRepository) {}

  async findAll() {
    return this.deviceLocationRepository.findAll();
  }

  async findById(id: number) {
    return this.deviceLocationRepository.findById(id);
  }

  async create(createDeviceLocationDto: CreateDeviceLocationDto) {
    return this.deviceLocationRepository.create(createDeviceLocationDto);
  }

  async update(id: number, updateDeviceLocationDto: UpdateDeviceLocationDto) {
    return this.deviceLocationRepository.update(id, updateDeviceLocationDto);
  }

  async delete(id: number) {
    return this.deviceLocationRepository.delete(id);
  }
}
