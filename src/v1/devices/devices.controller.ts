import {
  BadRequestException,
  Body,
  Controller,
  Get,
  InternalServerErrorException,
  NotImplementedException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { DevicesService } from './devices.service';
import { JwtAuthGuard } from '../auth/guards/jwt.auth.guard';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiSecurity,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { DeviceDto } from './dto/device.dto';
import { UpdateDevicePermissionDto } from './dto/update-device-permission.dto';
import { UpdateDeviceNameGroupLocalDto } from './dto/update-device-name-group-local.dto';
import { ReplaceDeviceDto } from './dto/replace-device.dto';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/authenticated-user';

@Controller({ path: 'devices', version: '1' })
@ApiBearerAuth('bearerAuth')
@ApiSecurity('apiKey')
@UseGuards(JwtAuthGuard)
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  @Get()
  @ApiOkResponse({
    description:
      "Current all of the user's authenticated devices returned when run successfully.",
    type: DeviceDto,
    isArray: true,
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid bearer token.',
    type: ErrorResponseDto,
    example: {
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Unauthorized',
    },
  })
  @ApiInternalServerErrorResponse({
    description: 'Failed to fetch devices.',
    type: ErrorResponseDto,
    example: {
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'Failed to fetch devices',
    },
  })
  @ApiOperation({
    summary: 'Get all devices for the authenticated user',
    description: `
    Returns all devices for the authenticated user.`,
  })
  @ApiQuery({
    name: 'skip',
    description: 'Number of records to skip for pagination',
    required: false,
  })
  @ApiQuery({
    name: 'take',
    description: 'Number of records to take for pagination',
    required: false,
  })
  @ApiQuery({
    name: 'group',
    description: 'Filter by device group',
    required: false,
  })
  @ApiQuery({
    name: 'name',
    description: 'Filter by device name or dev_eui',
    required: false,
  })
  @ApiQuery({
    name: 'location',
    description: 'Filter by device location',
    required: false,
  })
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query('skip') rawSkip?: string,
    @Query('take') rawTake?: string,
    @Query('group') searchGroup?: string,
    @Query('name') searchName?: string,
    @Query('location') searchLocation?: string,
  ) {
    const parsedSkip = parseInt(rawSkip ?? '', 10);
    const parsedTake = parseInt(rawTake ?? '', 10);
    const skip = Number.isNaN(parsedSkip) ? 0 : parsedSkip;
    const take = Math.min(Number.isNaN(parsedTake) ? 100 : parsedTake, 1000);
    return this.devicesService.findAll(
      user,
      skip,
      take,
      searchGroup || undefined,
      searchName || undefined,
      searchLocation || undefined,
    );
  }

  @Get('status')
  @ApiOperation({
    summary: 'Returns online vs offline devices for the authenticated user',
    description: `
    Returns the online vs offline status of all devices for the authenticated user.`,
  })
  findAllDeviceStatus(@CurrentUser() user: AuthenticatedUser) {
    return this.devicesService.findAllStatus(user);
  }

  @Get('groups')
  @ApiOperation({
    summary: 'Returns device groups for the authenticated user',
    description: `
    Returns the device groups for the authenticated user.`,
  })
  findAllDeviceGroups(@CurrentUser() user: AuthenticatedUser) {
    return this.devicesService.findAllDeviceGroups(user);
  }

  @Get('device-types')
  @ApiOperation({
    summary: 'Returns device types for the authenticated user',
    description: `
    Returns the device types for the authenticated user.`,
  })
  findAllDeviceTypes() {
    return this.devicesService.findAllDeviceTypes();
  }

  @Get('latest-primary-data')
  @ApiQuery({
    name: 'skip',
    description: 'Number of records to skip for pagination',
    required: false,
  })
  @ApiQuery({
    name: 'take',
    description: 'Number of records to take for pagination',
    required: false,
  })
  @ApiQuery({
    name: 'group-by-device-group',
    description: 'Filter by device group',
    required: false,
  })
  @ApiQuery({
    name: 'name',
    description: 'Filter by device name or dev_eui',
    required: false,
  })
  @ApiQuery({
    name: 'location',
    description: 'Filter by device location',
    required: false,
  })
  @ApiQuery({
    name: 'locationGroup',
    description: 'Group devices by location',
    required: false,
  })
  @ApiOperation({
    summary: 'Get the latest primary data for all devices (paginated)',
    description: `
    Returns the latest, 2 primary data values from the table record for all devices.`,
  })
  allLatestPrimaryData(
    @CurrentUser() user: AuthenticatedUser,
    @Query('skip') rawSkip?: string,
    @Query('take') rawTake?: string,
    @Query('group-by-device-group') searchDeviceGroup?: string,
    @Query('locationGroup') locationGroup?: string,
    @Query('name') searchName?: string,
    @Query('location') searchLocation?: string,
  ) {
    const skip = parseInt(rawSkip ?? '', 10) || 0;
    const take = parseInt(rawTake ?? '', 10) || 10;
    return this.devicesService.findAllLatestData(
      user,
      skip,
      take,
      searchDeviceGroup || undefined,
      searchName || undefined,
      searchLocation || undefined,
      locationGroup || undefined,
    );
  }

  @Get('location/:location_id')
  @ApiParam({
    name: 'location_id',
    description: 'Location ID',
    type: Number,
    required: true,
  })
  @ApiOperation({
    summary:
      'Get the latest primary data for all devices in a location (paginated)',
    description: `
    Returns the latest, 2 primary data values from the table record for all devices in a specific location.`,
  })
  allDevicesInLocation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('location_id') locationId: number,
  ) {
    return this.devicesService.findAllDevicesInLocation(user, locationId);
  }

  @Get(':dev_eui')
  @ApiOkResponse({
    description: "Current user's device returned successfully.",
    type: DeviceDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid dev_eui.',
    type: ErrorResponseDto,
    example: {
      statusCode: 400,
      error: 'Bad Request',
      message: 'dev_eui is required',
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid bearer token.',
    type: ErrorResponseDto,
    example: {
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Unauthorized',
    },
  })
  @ApiNotFoundResponse({
    description: 'Device not found.',
    type: ErrorResponseDto,
    example: {
      statusCode: 404,
      error: 'Not Found',
      message: 'Device not found',
    },
  })
  @ApiInternalServerErrorResponse({
    description: 'Failed to fetch device.',
    type: ErrorResponseDto,
    example: {
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'Failed to fetch device',
    },
  })
  @ApiParam({ name: 'dev_eui', description: 'Device dev_eui' })
  @ApiOperation({
    summary: 'Get a specific device for the authenticated user',
    description: `
    Returns a specific device for the authenticated user.`,
  })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('dev_eui') devEui: string,
  ) {
    if (!devEui?.trim()) {
      throw new BadRequestException('dev_eui is required');
    }
    return this.devicesService.findOne(user, devEui);
  }

  @Get(':dev_eui/data')
  @ApiParam({ name: 'dev_eui', description: 'Device dev_eui' })
  @ApiParam({
    name: 'skip (0)',
    description: 'Number of records to skip for pagination',
    required: false,
  })
  @ApiParam({
    name: 'take (144)',
    description: 'Number of records to take for pagination',
    required: false,
  })
  @ApiOperation({
    summary: 'Get the latest FULL data for a device (paginated)',
    description: `
    Returns the latest, data from the table record for a device paginated.`,
  })
  data(
    @CurrentUser() user: AuthenticatedUser,
    @Param('dev_eui') devEui: string,
    @Query('skip') rawSkip?: string,
    @Query('take') rawTake?: string,
  ) {
    if (!devEui?.trim()) {
      throw new BadRequestException('dev_eui is required');
    }
    const skip = parseInt(rawSkip ?? '', 10) || 0;
    const take = parseInt(rawTake ?? '', 10) || 144;
    return this.devicesService.findData(user, devEui, skip, take);
  }

  @Get(':dev_eui/data-within-range')
  @ApiParam({ name: 'dev_eui', description: 'Device dev_eui' })
  @ApiQuery({
    name: 'start',
    required: false,
    description: 'ISO 8601 date/time. Defaults to 24 hours before end/now.',
    schema: {
      type: 'string',
      format: 'date-time',
      default: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    },
    example: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
  })
  @ApiQuery({
    name: 'end',
    required: false,
    description: 'ISO 8601 date/time. Defaults to now.',
    schema: {
      type: 'string',
      format: 'date-time',
      default: new Date().toISOString(),
    },
    example: new Date().toISOString(),
  })
  @ApiParam({
    name: 'skip (0)',
    description: 'Number of records to skip for pagination',
    schema: {
      type: 'number',
      format: 'int32',
      default: 0,
    },
    required: false,
  })
  @ApiParam({
    name: 'take (144)',
    description: 'Number of records to take for pagination',
    schema: {
      type: 'number',
      format: 'int32',
      default: 144,
    },
    required: false,
  })
  @ApiOperation({
    summary: 'Get device FULL data within a date/time range and paginated',
    description: `
    Returns paginated sensor full data for a device filtered to a specific date/time window.
    Within the time window, the skip/take will be applied to the filtered data for pagination. For example, if there are 100 records in the time window and skip=10 and take=20, records 11-30 will be returned.
    Defaults to the last 24 hours if no range is provided.`,
  })
  dataWithinRange(
    @CurrentUser() user: AuthenticatedUser,
    @Param('dev_eui') devEui: string,
    @Query('skip') rawSkip?: string,
    @Query('take') rawTake?: string,
    @Query('start') rawStart?: string,
    @Query('end') rawEnd?: string,
  ) {
    if (!devEui?.trim()) {
      throw new BadRequestException('dev_eui is required');
    }
    const skip = parseInt(rawSkip ?? '', 10) || 0;
    const take = parseInt(rawTake ?? '', 10) || 144;
    const start =
      rawStart || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const end = rawEnd || new Date().toISOString();
    return this.devicesService.findDataWithinRange(
      user,
      devEui,
      start,
      end,
      skip,
      take,
    );
  }

  @Get(':dev_eui/latest-data')
  @ApiParam({ name: 'dev_eui', description: 'Device dev_eui' })
  @ApiOperation({
    summary: 'Get the 1 latest FULL data value for a device',
    description: `
    Returns the full latest data record for a device.`,
  })
  latestData(
    @CurrentUser() user: AuthenticatedUser,
    @Param('dev_eui') devEui: string,
  ) {
    if (!devEui?.trim()) {
      throw new BadRequestException('dev_eui is required');
    }
    return this.devicesService.findLatestData(user, devEui);
  }

  @Get(':dev_eui/latest-primary-data')
  @ApiParam({ name: 'dev_eui', description: 'Device dev_eui' })
  @ApiOperation({
    summary: 'Get the latest primary data for a device',
    description: `
    Returns the latest, 2 primary data values from the table record for a device.`,
  })
  latestPrimaryData(
    @CurrentUser() user: AuthenticatedUser,
    @Param('dev_eui') devEui: string,
  ) {
    if (!devEui?.trim()) {
      throw new BadRequestException('dev_eui is required');
    }
    return this.devicesService.findLatestData(user, devEui, true);
  }

  @Post(':dev_eui')
  @ApiParam({ name: 'dev_eui', description: 'Device dev_eui' })
  @ApiOperation({
    summary: 'Create a new device for the authenticated user',
    description: `
    Creates a new device for the authenticated user.
    This endpoint is not yet implemented and will return a 501 Not Implemented response until it is implemented.
    Please contact support if you would like this feature to be prioritized.
    `,
  })
  create(@Param('dev_eui') _devEui: string) {
    throw new NotImplementedException(
      'Device creation is not yet implemented. Please contact support if you would like this feature to be prioritized.',
    );
  }

  @Post(':dev_eui/replace')
  @ApiParam({ name: 'dev_eui', description: 'Device dev_eui' })
  @ApiOperation({
    summary:
      '🔄 Replace a device with another device for the authenticated user',
    description: `
    Replaces an existing device with a new device for the authenticated user.
    This endpoint is not yet implemented and will return a 501 Not Implemented response until it is implemented.
    Please contact support if you would like this feature to be prioritized.
    `,
  })
  async replace(
    @CurrentUser() user: AuthenticatedUser,
    @Param('dev_eui') devEui: string,
    @Body() body: ReplaceDeviceDto,
  ) {
    const normalizedDevEui = devEui?.trim();
    if (body.dev_eui?.trim() && body.dev_eui.trim() !== normalizedDevEui) {
      throw new BadRequestException(
        'dev_eui in body must match route parameter',
      );
    }

    const replacementDevice: ReplaceDeviceDto = body;

    const insertResult = await this.devicesService.replaceDevice(
      user,
      normalizedDevEui,
      replacementDevice,
    );
    if (!insertResult) {
      throw new InternalServerErrorException(
        'Device replacement is not yet implemented. Please contact support if you would like this feature to be prioritized.',
      );
    }
    return insertResult;
  }

  @Patch(':dev_eui/permission-level')
  @ApiParam({ name: 'dev_eui', description: 'Device dev_eui' })
  @ApiOperation({
    summary: 'Update the permission level for a device',
    description: `
    Updates the permission level for a device.
    This endpoint is not yet implemented and will return a 501 Not Implemented response until it is implemented.
    Please contact support if you would like this feature to be prioritized.
    `,
  })
  updatePermissionLevel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('dev_eui') devEui: string,
    @Body() body: UpdateDevicePermissionDto,
  ) {
    const normalizedDevEui = devEui?.trim();

    if (!normalizedDevEui) {
      throw new BadRequestException('dev_eui is required');
    }
    if (body.dev_eui?.trim() && body.dev_eui.trim() !== normalizedDevEui) {
      throw new BadRequestException(
        'dev_eui in body must match route parameter',
      );
    }
    if (!body.targetUserEmail?.trim()) {
      throw new BadRequestException('Target User Email is required');
    }
    if (!body.permissionLevel) {
      throw new BadRequestException('Permission Level is required');
    }
    return this.devicesService.updatePermissionLevel(
      user,
      normalizedDevEui,
      body.targetUserEmail,
      body.permissionLevel,
    );
  }

  @Patch(':dev_eui')
  @ApiParam({ name: 'dev_eui', description: 'Device dev_eui' })
  @ApiOperation({
    summary: 'Update a device',
    description: `
    Updates a device for the authenticated user.
    `,
  })
  updateDevice(
    @CurrentUser() user: AuthenticatedUser,
    @Param('dev_eui') devEui: string,
    @Body() body: UpdateDeviceNameGroupLocalDto,
  ) {
    if (!devEui?.trim()) {
      throw new BadRequestException('dev_eui is required');
    }
    if (!body.name?.trim()) {
      throw new BadRequestException('Device name is required');
    }
    if (!body.location_id) {
      throw new BadRequestException('Device location is required');
    }
    return this.devicesService.updateDevice(
      user,
      devEui,
      body.name,
      body.group ?? null,
      body.location_id,
    );
  }
}
