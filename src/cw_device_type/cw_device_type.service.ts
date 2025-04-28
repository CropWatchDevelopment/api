import { Injectable } from '@nestjs/common';
import { BaseService } from '../bases/base.service';
import { CreateDeviceTypeDto } from './dto/create-device-type.dto';
import { UpdateDeviceTypeDto } from './dto/update-device-type.dto';
import { DeviceTypeRepository } from '../repositories/cw_device_type.repository';
import { DeviceTypeRow } from '../common/database-types';

@Injectable()
export class CwDeviceTypeService extends BaseService<DeviceTypeRow, CreateDeviceTypeDto, UpdateDeviceTypeDto> {
  constructor(deviceTypeRepository: DeviceTypeRepository) {
    super(deviceTypeRepository);
  }

  public async getDeviceTypeByDevType(devType: string): Promise<DeviceTypeRow> {
    return this.repository.findById(devType);
  }

}