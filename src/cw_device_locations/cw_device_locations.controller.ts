// src/cw_device_locations/cw_device_locations.controller.ts
import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { CreateDeviceLocationDto } from './dto/create-device-location.dto';
import { BaseController } from 'src/bases/base.controller';
import { Database } from 'database.types';
import { CwDeviceLocationsService } from './cw_device_locations.service';

type DeviceLocationRow = Database['public']['Tables']['cw_device_locations']['Row'];

@ApiTags('🔒Device➡️Locations')
@Controller('cw-device-locations')
export class CwDeviceLocationsController extends BaseController<DeviceLocationRow, CreateDeviceLocationDto> {
    constructor(cwDeviceLocationsService: CwDeviceLocationsService) {
        super(cwDeviceLocationsService);
    }
}