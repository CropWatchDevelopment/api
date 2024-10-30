import { Controller } from '@nestjs/common';
import { Database } from 'database.types';
import { BaseController } from 'src/bases/base.controller';
import { CreateDeviceTypeDto } from './dto/create-device-type.dto';
import { CwDeviceTypeService } from './cw_device_type.service';
import { ApiTags } from '@nestjs/swagger';

type DeviceTypeRow = Database['public']['Tables']['cw_device_type']['Row'];

@ApiTags('Device Type')
@Controller('cw-device-type')
export class CwDeviceTypeController extends BaseController<DeviceTypeRow, CreateDeviceTypeDto> {
    constructor(cwDeviceTypeService: CwDeviceTypeService) {
        super(cwDeviceTypeService);
    }
}
