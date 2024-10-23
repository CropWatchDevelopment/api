import { Injectable } from '@nestjs/common';
import { CreateDeviceDto } from './dto/create-device.dto';
import { UpdateDeviceDto } from './dto/update-device.dto';
import { RepositoryBaseService } from 'src/repository-base/repository-base.service';
import { Device } from './entities/device.entity';

@Injectable()
export class DeviceService extends RepositoryBaseService<Device> {
  async create(createDeviceDto: CreateDeviceDto): Promise<Device> {
    return super.create(createDeviceDto);
  }

  async update(id: number, updateDeviceDto: UpdateDeviceDto): Promise<Device> {
    return super.update(id, updateDeviceDto);
  }

  async remove(id: number): Promise<boolean> {
    return super.remove(id);
  }
}
