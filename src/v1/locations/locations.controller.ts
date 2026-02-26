import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  Req,
  BadRequestException,
} from '@nestjs/common';
import { LocationsService } from './locations.service';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.auth.guard';
import { ApiBearerAuth, ApiOkResponse, ApiParam, ApiQuery, ApiSecurity } from '@nestjs/swagger';
import { LocationDto } from './dto/location.dto';
import { UpdateLocationOwnerDto } from './dto/update-location-owner.dto';
import { CreateLocationOwnerDto } from './dto/create-location-owner.dto';

@Controller({ path: 'locations', version: '1' })
@ApiBearerAuth('bearerAuth')
@ApiSecurity('apiKey')
export class LocationsController {
  constructor(private readonly locationsService: LocationsService) { }

  @Post()
  create(@Body() createLocationDto: CreateLocationDto, @Req() req) {
    const authHeader = req.headers?.authorization ?? '';
    return this.locationsService.create(createLocationDto, req.user, authHeader);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({
    description:
      "Current all of the user's rules configurations.",
    type: LocationDto,
    isArray: true,
  })
  @Get()
  findAll(@Req() req) {
    const authHeader = req.headers?.authorization ?? '';
    return this.locationsService.findAll(req.user, authHeader);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({
    description:
      "Get a user's location configuration by ID.",
    type: LocationDto,
    isArray: false,
  })
  @Get(':id')
  findOne(@Param('id') id: number, @Req() req) {
    const authHeader = req.headers?.authorization ?? '';
    return this.locationsService.findOne(id, req.user, authHeader);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateLocationDto: UpdateLocationDto) {
    return this.locationsService.update(+id, updateLocationDto);
  }

  @Post(':id/permission')
  @UseGuards(JwtAuthGuard)
  @ApiParam({ name: 'id', description: 'ID of the location to update permissions for', type: Number })
  @ApiParam({ name: 'newUserEmail', description: 'Email of the user to grant permissions to', type: String, example: 'user@example.com' })
  @ApiQuery({ name: 'applyToAllDevices', description: 'Whether to apply the permission change to all devices associated with the location', type: Boolean, required: false })
  @ApiOkResponse({
    description: 'The location permission has been successfully updated.',
    type: LocationDto,
  })
  async createLocationPermission(@Param('id') id: string, @Body() createLocationOwnerDto: CreateLocationOwnerDto, @Query('permission_level') permissionLevel: number, @Query('applyToAllDevices') applyToAllDevices: string = 'false', @Req() req) {
    const authHeader = req.headers?.authorization ?? '';
    const applyToAllDevicesFlag = applyToAllDevices === 'true';
    return this.locationsService.createLocationPermission(+id, createLocationOwnerDto, permissionLevel, applyToAllDevicesFlag, req.user, authHeader);
  }

  @Patch(':id/permission')
  @UseGuards(JwtAuthGuard)
  @ApiParam({ name: 'id', description: 'ID of the location to update permissions for', type: Number })
  @ApiQuery({ name: 'applyToAllDevices', description: 'Whether to apply the permission change to all devices associated with the location', type: Boolean, required: false })
  @ApiOkResponse({
    description: 'The location permission has been successfully updated.',
    type: LocationDto,
  })

  async updateLocationPermission(@Param('id') id: string, @Body() updateLocationOwnerDto: UpdateLocationOwnerDto, @Query('applyToAllDevices') applyToAllDevices: string = 'false', @Req() req) {
    const authHeader = req.headers?.authorization ?? '';
    const applyToAllDevicesFlag = applyToAllDevices === 'true';
    return this.locationsService.updateLocationPermission(+id, updateLocationOwnerDto, applyToAllDevicesFlag, req.user, authHeader);
  }

  @Delete(':id/permission')
  @UseGuards(JwtAuthGuard)
  remove(@Param('id') id: number, @Query('permission_id') permissionId: number, @Req() req) {
    if (!id || !permissionId) {
      throw new BadRequestException('Location ID and Permission ID are required');
    }

    const authHeader = req.headers?.authorization ?? '';
    return this.locationsService.removeLocationPermission(id, permissionId, req.user, authHeader);
  }
}
