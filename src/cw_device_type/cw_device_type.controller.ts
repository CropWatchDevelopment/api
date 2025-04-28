import { Controller } from '@nestjs/common';
import { BaseController } from '../bases/base.controller';
import { CreateDeviceTypeDto } from './dto/create-device-type.dto';
import { CwDeviceTypeService } from './cw_device_type.service';
import { ApiTags } from '@nestjs/swagger';
import { DeviceTypeRow } from '../common/database-types';
import { UpdateDeviceTypeDto } from './dto/update-device-type.dto';

@ApiTags('Device Type')
@Controller('cw-device-type')
export class CwDeviceTypeController extends BaseController<DeviceTypeRow, CreateDeviceTypeDto, UpdateDeviceTypeDto> {
    constructor(cwDeviceTypeService: CwDeviceTypeService) {
        super(cwDeviceTypeService);
    }
}
