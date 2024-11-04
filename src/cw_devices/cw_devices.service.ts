import { Injectable } from '@nestjs/common';
import { BaseService } from '../bases/base.service';
import { DeviceRepository } from '../repositories/cw_devices.repository';
import { UpdateDeviceDto } from './dto/update-device.dto';
import { CreateDeviceDto } from './dto/create-device.dto';
import { DevicesRow } from '../common/database-types';

@Injectable()
export class CwDevicesService extends BaseService<DevicesRow, CreateDeviceDto, UpdateDeviceDto> {
  constructor(private readonly deviceRepository: DeviceRepository) {
    super(deviceRepository);
  }

  public async getDeviceByDevEui(devEui: string): Promise<DevicesRow> {
    return this.deviceRepository.findByDevEui({ dev_eui: devEui });
  }

}
