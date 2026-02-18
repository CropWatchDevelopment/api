import {
  BadRequestException,
  Controller,
  Get,
  NotImplementedException,
  Param,
  Post,
  Req,
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

@Controller('devices')
@ApiBearerAuth('bearerAuth')
@ApiSecurity('apiKey')
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) { }

  @Get()
  @UseGuards(JwtAuthGuard)
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
  findAll(@Req() req) {
    return this.devicesService.findAll(req.user, req.headers.authorization);
  }

  @Get(':dev_eui')
  @UseGuards(JwtAuthGuard)
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
  findOne(@Req() req, @Param('dev_eui') devEui: string) {
    if (!devEui?.trim()) {
      throw new BadRequestException('dev_eui is required');
    }
    return this.devicesService.findOne(req.user, devEui, req.headers.authorization);
  }

  @Get(':dev_eui/data')
  @UseGuards(JwtAuthGuard)
  @ApiParam({ name: 'dev_eui', description: 'Device dev_eui' })
  @ApiParam({ name: 'skip (0)', description: 'Number of records to skip for pagination', required: false })
  @ApiParam({ name: 'take (144)', description: 'Number of records to take for pagination', required: false })
  @ApiOperation({
    summary: 'Get the latest FULL data for a device (paginated)',
    description: `
    Returns the latest, data from the table record for a device paginated.`,
  })
  data(@Req() req, @Param('dev_eui') devEui: string) {
    if (!devEui?.trim()) {
      throw new BadRequestException('dev_eui is required');
    }
    const skip = parseInt(req.query.skip, 10) || 0;
    const take = parseInt(req.query.take, 10) || 144;
    return this.devicesService.findData(req.user, devEui, skip, take, req.headers.authorization);
  }

  @Get(':dev_eui/data-within-range')
  @UseGuards(JwtAuthGuard)
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
    name: 'skip (0)', description: 'Number of records to skip for pagination', schema: {
      type: 'number',
      format: 'int32',
      default: 0,
    }, required: false
  })
  @ApiParam({
    name: 'take (144)', description: 'Number of records to take for pagination', schema: {
      type: 'number',
      format: 'int32',
      default: 144,
    }, required: false
  })
  @ApiOperation({
    summary: 'Get device FULL data within a date/time range and paginated',
    description: `
    Returns paginated sensor full data for a device filtered to a specific date/time window.
    Within the time window, the skip/take will be applied to the filtered data for pagination. For example, if there are 100 records in the time window and skip=10 and take=20, records 11-30 will be returned.
    Defaults to the last 24 hours if no range is provided.`,
  })
  dataWithinRange(@Req() req, @Param('dev_eui') devEui: string) {
    if (!devEui?.trim()) {
      throw new BadRequestException('dev_eui is required');
    }
    const skip = parseInt(req.query.skip, 10) || 0;
    const take = parseInt(req.query.take, 10) || 144;
    const start = req.query.start || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const end = req.query.end || new Date().toISOString();
    return this.devicesService.findDataWithinRange(req.user, devEui, req.headers.authorization, start, end, skip, take);
  }

  @Get(':dev_eui/latest-data')
  @UseGuards(JwtAuthGuard)
  @ApiParam({ name: 'dev_eui', description: 'Device dev_eui' })
  @ApiOperation({
    summary: 'Get the 1 latest FULL data value for a device',
    description: `
    Returns the full latest data record for a device.`,
  })
  latestData(@Req() req, @Param('dev_eui') devEui: string) {
    if (!devEui?.trim()) {
      throw new BadRequestException('dev_eui is required');
    }
    return this.devicesService.findLatestData(req.user, devEui, req.headers.authorization);
  }

  @Get(':dev_eui/latest-primary-data')
  @UseGuards(JwtAuthGuard)
  @ApiParam({ name: 'dev_eui', description: 'Device dev_eui' })
  @ApiOperation({
    summary: 'Get the latest primary data for a device',
    description: `
    Returns the latest, 2 primary data values from the table record for a device.`,
  })
  latestPrimaryData(@Req() req, @Param('dev_eui') devEui: string) {
    if (!devEui?.trim()) {
      throw new BadRequestException('dev_eui is required');
    }
    return this.devicesService.findLatestData(req.user, devEui, req.headers.authorization, true);
  }

  @Post(':dev_eui')
  @UseGuards(JwtAuthGuard)
  @ApiParam({ name: 'dev_eui', description: 'Device dev_eui' })
  create(@Req() req, @Param('dev_eui') devEui: string) {
    throw NotImplementedException;
  }
}
