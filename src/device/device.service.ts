import { Injectable } from '@nestjs/common';
import { CreateDeviceDto } from './dto/create-device.dto';
import { UpdateDeviceDto } from './dto/update-device.dto';
import { Device } from './entities/device.entity';
import { DeviceRepository } from './repositories/device.repository';

@Injectable()
export class DeviceService {
  constructor(private readonly deviceRepository: DeviceRepository) {
    
  }

  // create(createDeviceDto: CreateDeviceDto) {
  //   return super.create(createDeviceDto);
  // }

  findAll() {
    return this.deviceRepository.findAll();
  }

  // findOne(id: number) {
  //   return super.findOne(id);
  // }

  // update(id: number, updateDeviceDto: UpdateDeviceDto) {
  //   return super.update(id, updateDeviceDto);
  // }

  // remove(id: number) {
  //   return super.remove(id);
  // }
}
