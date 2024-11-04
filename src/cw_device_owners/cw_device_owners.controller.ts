// src/cw_device_owners/cw_device_owners.controller.ts
import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { CwDeviceOwnersService } from './cw_device_owners.service';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { CreateDeviceOwnerDto } from './dto/create-device-owner.dto';
import { UpdateDeviceOwnerDto } from './dto/update-device-owner.dto';
import { BaseController } from 'src/bases/base.controller';
import { Database } from 'database.types';

type DevicesOwnersRow = Database['public']['Tables']['cw_device_owners']['Row'];

@ApiTags('🔒Device-Owners - CRUD operations for linkages between current JWT users profile and devices')
@Controller('cw-device-owners')
export class CwDeviceOwnersController extends BaseController<DevicesOwnersRow, CreateDeviceOwnerDto> {
  constructor(private readonly cwDeviceOwnersService: CwDeviceOwnersService) {
    super(cwDeviceOwnersService);
  }
}
