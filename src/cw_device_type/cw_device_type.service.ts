import { Injectable } from '@nestjs/common';
import { BaseService } from 'src/bases/base.service';
import { CreateDeviceTypeDto } from './dto/create-device-type.dto';
import { UpdateDeviceTypeDto } from './dto/update-device-type.dto';
import { DeviceTypeRepository } from 'src/repositories/cw_device_type.repository';
import { DeviceTypeRow } from 'src/common/database-types';

@Injectable()
export class CwDeviceTypeService extends BaseService<DeviceTypeRow, CreateDeviceTypeDto, UpdateDeviceTypeDto> {
  constructor(private readonly deviceTypeRepository: DeviceTypeRepository) {
    super(deviceTypeRepository);
  }

  public async getDeviceTypeByDevType(devType: string): Promise<DeviceTypeRow> {
    return this.deviceTypeRepository.findByDeviceType({ dev_type: devType });
  }

}