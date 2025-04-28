// src/cw_device_owners/cw_device_owners.controller.ts
import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { CwDeviceOwnersService } from './cw_device_owners.service';
import { ApiTags } from '@nestjs/swagger';
import { CreateDeviceOwnerDto } from './dto/create-device-owner.dto';
import { BaseController } from '../bases/base.controller';
import { DevicesOwnersRow } from '../common/database-types';
import { UpdateDeviceOwnerDto } from './dto/update-device-owner.dto';

@ApiTags('🔒Device-Owners - CRUD operations for linkages between current JWT users profile and devices')
@Controller('cw-device-owners')
export class CwDeviceOwnersController extends BaseController<DevicesOwnersRow, CreateDeviceOwnerDto, UpdateDeviceOwnerDto> {
  constructor(cwDeviceOwnersService: CwDeviceOwnersService) {
    super(cwDeviceOwnersService);
  }
}
