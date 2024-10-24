// src/cw_device_owners/cw_device_owners.controller.ts
import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { CwDeviceOwnersService } from './cw_device_owners.service';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { CreateDeviceOwnerDto } from './dto/create-device-owner.dto';
import { UpdateDeviceOwnerDto } from './dto/update-device-owner.dto';

@ApiTags('🔒Device➡️Owners')
@Controller('cw-device-owners')
export class CwDeviceOwnersController {
  constructor(private readonly cwDeviceOwnersService: CwDeviceOwnersService) {}

  @ApiOperation({ summary: 'Get all device owners' })
  @Get()
  findAll() {
    return this.cwDeviceOwnersService.findAll();
  }

  @ApiOperation({ summary: 'Get a device owner by ID' })
  @Get(':id')
  findOne(@Param('id') id: number) {
    return this.cwDeviceOwnersService.findById(id);
  }

  @ApiOperation({ summary: 'Create a new device owner' })
  @Post()
  create(@Body() createDeviceOwnerDto: CreateDeviceOwnerDto) {
    return this.cwDeviceOwnersService.create(createDeviceOwnerDto);
  }

  @ApiOperation({ summary: 'Update a device owner by ID' })
  @Patch(':id')
  update(@Param('id') id: number, @Body() updateDeviceOwnerDto: UpdateDeviceOwnerDto) {
    return this.cwDeviceOwnersService.update(id, updateDeviceOwnerDto);
  }

  @ApiOperation({ summary: 'Delete a device owner by ID' })
  @Delete(':id')
  remove(@Param('id') id: number) {
    return this.cwDeviceOwnersService.delete(id);
  }
}
