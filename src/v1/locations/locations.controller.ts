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
  BadRequestException,
} from '@nestjs/common';
import { LocationsService } from './locations.service';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.auth.guard';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiParam,
  ApiQuery,
  ApiSecurity,
} from '@nestjs/swagger';
import { LocationDto } from './dto/location.dto';
import { UpdateLocationOwnerDto } from './dto/update-location-owner.dto';
import { CreateLocationOwnerDto } from './dto/create-location-owner.dto';
import {
  isValidPermissionLevel,
  MAX_PERMISSION_LEVEL,
  MIN_PERMISSION_LEVEL,
} from '../common/permission-levels';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/authenticated-user';

@Controller({ path: 'locations', version: '1' })
@ApiBearerAuth('bearerAuth')
@ApiSecurity('apiKey')
@UseGuards(JwtAuthGuard)
export class LocationsController {
  constructor(private readonly locationsService: LocationsService) {}

  @Post()
  create(
    @Body() createLocationDto: CreateLocationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.locationsService.create(createLocationDto, user);
  }
  @ApiOkResponse({
    description: "Current all of the user's rules configurations.",
    type: LocationDto,
    isArray: true,
  })
  @ApiQuery({
    name: 'name',
    description: 'Filter by location name',
    required: false,
  })
  @Get()
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query('name') searchName?: string,
  ) {
    return this.locationsService.findAll(user, searchName || undefined);
  }
  @ApiOkResponse({
    description: "Current all of the user's location groups.",
    type: String,
    isArray: true,
  })
  @Get('groups')
  findLocationGroups(@CurrentUser() user: AuthenticatedUser) {
    return this.locationsService.findAllLocationGroups(user);
  }
  @ApiOkResponse({
    description: "Get a user's location configuration by ID.",
    type: LocationDto,
    isArray: false,
  })
  @Get(':id')
  findOne(@Param('id') id: number, @CurrentUser() user: AuthenticatedUser) {
    return this.locationsService.findOne(id, user);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateLocationDto: UpdateLocationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.locationsService.update(+id, updateLocationDto, user);
  }

  @Post(':id/permission')
  @ApiParam({
    name: 'id',
    description: 'ID of the location to update permissions for',
    type: Number,
  })
  @ApiParam({
    name: 'newUserEmail',
    description: 'Email of the user to grant permissions to',
    type: String,
    example: 'user@example.com',
  })
  @ApiQuery({
    name: 'applyToAllDevices',
    description:
      'Whether to apply the permission change to all devices associated with the location',
    type: Boolean,
    required: false,
  })
  @ApiOkResponse({
    description: 'The location permission has been successfully updated.',
    type: LocationDto,
  })
  async createLocationPermission(
    @Param('id') id: string,
    @Body() createLocationOwnerDto: CreateLocationOwnerDto,
    @Query('newUserEmail') newUserEmail: string | undefined,
    @Query('permission_level') permissionLevel: number,
    @Query('applyToAllDevices') applyToAllDevices: string = 'false',
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const locationId = Number.parseInt(id, 10);
    const normalizedNewUserEmail =
      createLocationOwnerDto.user_email?.trim() || newUserEmail?.trim();
    const applyToAllDevicesFlag =
      applyToAllDevices === 'true' ||
      createLocationOwnerDto.applyToAllDevices === true;

    if (!Number.isInteger(locationId) || locationId < 1) {
      throw new BadRequestException('Location ID is required');
    }
    if (!normalizedNewUserEmail) {
      throw new BadRequestException('New user email is required');
    }
    if (!isValidPermissionLevel(permissionLevel)) {
      throw new BadRequestException(
        `Permission level must be between ${MIN_PERMISSION_LEVEL} and ${MAX_PERMISSION_LEVEL}`,
      );
    }
    if (
      typeof createLocationOwnerDto.location_id === 'number' &&
      createLocationOwnerDto.location_id !== locationId
    ) {
      throw new BadRequestException(
        'location_id in body must match route parameter',
      );
    }

    return this.locationsService.createLocationPermission(
      locationId,
      {
        ...createLocationOwnerDto,
        location_id: locationId,
        user_email: normalizedNewUserEmail,
      },
      permissionLevel,
      applyToAllDevicesFlag,
      user,
    );
  }

  @Patch(':id/permission')
  @ApiParam({
    name: 'id',
    description: 'ID of the location to update permissions for',
    type: Number,
  })
  @ApiQuery({
    name: 'applyToAllDevices',
    description:
      'Whether to apply the permission change to all devices associated with the location',
    type: Boolean,
    required: false,
  })
  @ApiOkResponse({
    description: 'The location permission has been successfully updated.',
    type: LocationDto,
  })
  async updateLocationPermission(
    @Param('id') id: string,
    @Body() updateLocationOwnerDto: UpdateLocationOwnerDto,
    @Query('applyToAllDevices') applyToAllDevices: string = 'false',
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const applyToAllDevicesFlag = applyToAllDevices === 'true';
    return this.locationsService.updateLocationPermission(
      +id,
      updateLocationOwnerDto,
      applyToAllDevicesFlag,
      user,
    );
  }

  @Patch(':id/permission-level')
  @ApiParam({
    name: 'id',
    description: 'ID of the location to update permissions for',
    type: Number,
  })
  @ApiQuery({
    name: 'applyToAllDevices',
    description:
      'Whether to apply the permission change to all devices associated with the location',
    type: Boolean,
    required: false,
  })
  @ApiOkResponse({
    description: 'The location permission has been successfully updated.',
    type: LocationDto,
  })
  async updateUserPermissionLevel(
    @Param('id') id: string,
    @Body() updateLocationUserPermissionLevelDto: any,
    @Query('applyToAllDevices') applyToAllDevices: string = 'false',
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const applyToAllDevicesFlag = applyToAllDevices === 'true';
    return this.locationsService.updateUserPermissionLevel(
      +id,
      updateLocationUserPermissionLevelDto,
      applyToAllDevicesFlag,
      user,
    );
  }

  @Delete(':id/permission')
  remove(
    @Param('id') id: number,
    @Query('permission_id') permissionId: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!id || !permissionId) {
      throw new BadRequestException(
        'Location ID and Permission ID are required',
      );
    }
    return this.locationsService.removeLocationPermission(
      id,
      permissionId,
      user,
    );
  }
}
