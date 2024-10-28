import { Get, Post, Body, Patch, Param, Delete, Controller } from '@nestjs/common';
import { CwDevicesService } from './cw_devices.service';
import { ApiTags } from '@nestjs/swagger';
import { Database } from 'database.types';
import { BaseController } from 'src/bases/base.controller';
import { CreateDeviceLocationDto } from 'src/cw_device_locations/dto/create-device-location.dto';

type DevicesRow = Database['public']['Tables']['cw_devices']['Row'];

@ApiTags('Devices')
@Controller('cw-devices')
export class CwDevicesController extends BaseController<DevicesRow, CreateDeviceLocationDto> {
  constructor(cwDevicesService: CwDevicesService) {
    super(cwDevicesService);
  }
}
