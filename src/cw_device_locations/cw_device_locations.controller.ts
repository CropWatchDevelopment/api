// src/cw_device_locations/cw_device_locations.controller.ts
import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { CwDeviceLocationsService } from './cw_device_locations.service';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { CreateDeviceLocationDto } from './dto/create-device-location.dto';
import { UpdateDeviceLocationDto } from './dto/update-device-location.dto';

@ApiTags('🔒Device➡️Locations')
@Controller('cw-device-locations')
export class CwDeviceLocationsController {
    constructor(private readonly cwDeviceLocationsService: CwDeviceLocationsService) { }

    @ApiOperation({ summary: 'Get all device locations' })
    @Get()
    findAll() {
        return this.cwDeviceLocationsService.findAll();
    }

    @ApiOperation({ summary: 'Get a device location by ID' })
    @Get(':id')
    findOne(@Param('id') id: number) {
        return this.cwDeviceLocationsService.findById(id);
    }

    @ApiOperation({ summary: 'Create a new device location' })
    @Post()
    create(@Body() createDeviceLocationDto: CreateDeviceLocationDto) {
        return this.cwDeviceLocationsService.create(createDeviceLocationDto);
    }

    @ApiOperation({ summary: 'Update a device location by ID' })
    @Patch(':id')
    update(@Param('id') id: number, @Body() updateDeviceLocationDto: UpdateDeviceLocationDto) {
        return this.cwDeviceLocationsService.update(id, updateDeviceLocationDto);
    }

    @ApiOperation({ summary: 'Delete a device location by ID' })
    @Delete(':id')
    remove(@Param('id') id: number) {
        return this.cwDeviceLocationsService.delete(id);
    }
}
