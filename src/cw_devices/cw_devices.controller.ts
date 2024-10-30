// src/cw_devices/cw_devices.controller.ts
import { Controller, Get, Post, Body, Patch, Param, Delete, Req, UseGuards } from '@nestjs/common';
import { CwDevicesService } from './cw_devices.service';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CreateDeviceDto } from './dto/create-device.dto';
import { UpdateDeviceDto } from './dto/update-device.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';

@ApiTags('Devices')
// @UseGuards(JwtAuthGuard)
@Controller('cw-devices')
export class CwDevicesController {
  constructor(private readonly cwDevicesService: CwDevicesService) {}

  @ApiOperation({ summary: 'Get all devices' })
  @Get()
  @ApiBearerAuth('XYZ')
  findAll(@Req() req) {
    return this.cwDevicesService.findAll(req.headers.authorization);
  }

  @ApiOperation({ summary: 'Get a device by ID' })
  @Get(':id')
  findOne(@Param('id') id: number, @Req() req) {
    return this.cwDevicesService.findById(id, req.headers.authorization);
  }

  @ApiOperation({ summary: 'Create a new device' })
  @Post()
  create(@Body() createDeviceDto: CreateDeviceDto, @Req() req) {
    return this.cwDevicesService.create(createDeviceDto, req.headers.authorization);
  }

  @ApiOperation({ summary: 'Update a device by ID' })
  @Patch(':id')
  update(@Param('id') id: number, @Body() updateDeviceDto: UpdateDeviceDto, @Req() req) {
    return this.cwDevicesService.update(id, updateDeviceDto, req.headers.authorization);
  }

  @ApiOperation({ summary: 'Delete a device by ID' })
  @Delete(':id')
  remove(@Param('id') id: number, @Req() req) {
    return this.cwDevicesService.delete(id, req.headers.authorization);
  }
}
