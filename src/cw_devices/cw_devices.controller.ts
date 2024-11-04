import { Get, Post, Body, Patch, Param, Delete, Controller } from '@nestjs/common';
import { CwDevicesService } from './cw_devices.service';
import { ApiBearerAuth, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { BaseController } from 'src/bases/base.controller';
import { CreateDeviceDto } from './dto/create-device.dto';
import { DevicesRow } from 'src/common/database-types';
import { UpdateDeviceDto } from './dto/update-device.dto';

@ApiBearerAuth('JWT')
@ApiSecurity('x-api-key', ['x-api-key'])
@ApiTags('Devices', 'Operations related to current JWT device management')
@Controller('cw-devices')
export class CwDevicesController extends BaseController<DevicesRow, CreateDeviceDto, UpdateDeviceDto> {
  constructor(cwDevicesService: CwDevicesService) {
    super(cwDevicesService);
  }
}
