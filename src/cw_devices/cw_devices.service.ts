// src/cw_devices/cw_devices.service.ts
import { Injectable } from '@nestjs/common';
import { CreateDeviceDto } from './dto/create-device.dto';
import { UpdateDeviceDto } from './dto/update-device.dto';
import { DeviceRepository } from 'src/repositories/cw_devices.repository';

@Injectable()
export class CwDevicesService {
    constructor(
        private readonly deviceRepository: DeviceRepository
    ) { }

    async findAll(token: string) {
        return this.deviceRepository.findAll(token);
    }

    async findById(id: number, token: string) {
        return this.deviceRepository.findById(id, token);
    }

    async create(createDeviceDto: CreateDeviceDto, token: string) {
        return this.deviceRepository.create(createDeviceDto, token);
    }

    async update(id: number, updateDeviceDto: UpdateDeviceDto, token: string) {
        return this.deviceRepository.update(id, updateDeviceDto, token);
    }

    async delete(id: number, token: string) {
        return this.deviceRepository.delete(id, token);
    }
}
