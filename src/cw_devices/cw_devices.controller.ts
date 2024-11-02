import { Get, Post, Body, Patch, Param, Delete, Controller } from '@nestjs/common';
import { CwDevicesService } from './cw_devices.service';
import { ApiTags } from '@nestjs/swagger';
import { Database } from 'database.types';
import { BaseController } from 'src/bases/base.controller';
import { CreateDeviceDto } from './dto/create-device.dto';

type DevicesRow = Database['public']['Tables']['cw_devices']['Row'];


@ApiTags('Devices', 'Operations related to current JWT device management')
@Controller('cw-devices')
export class CwDevicesController extends BaseController<DevicesRow, CreateDeviceDto> {
  constructor(cwDevicesService: CwDevicesService) {
    super(cwDevicesService);
  }
}
