import {
  BadRequestException,
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
} from '@nestjs/common';
import { TrafficService } from './traffic.service';
import { TrafficDataDto } from './dto/traffic-data.dto';
import { TrafficReportDto } from './dto/traffic-report.dto';
import { TrafficMonthlyReportDto } from './dto/traffic-monthly-report.dto';
import type { CreateTrafficDto } from './dto/create-traffic.dto';
import type { UpdateTrafficDto } from './dto/update-traffic.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.auth.guard';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiInternalServerErrorResponse,
  ApiOkResponse,
  ApiParam,
  ApiQuery,
  ApiSecurity,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../common/dto/error-response.dto';

@Controller({ path: 'traffic', version: '1' })
@ApiBearerAuth('bearerAuth')
@ApiSecurity('apiKey')
export class TrafficController {
  constructor(private readonly trafficService: TrafficService) {}

  @Get(':dev_eui')
  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({
    description: 'Traffic data returned successfully.',
    type: TrafficDataDto,
    isArray: true,
  })
  @ApiBadRequestResponse({
    description: 'Invalid dev_eui, start/end, or timezone.',
    type: ErrorResponseDto,
    example: {
      statusCode: 400,
      error: 'Bad Request',
      message: 'Validation failed',
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
  @ApiInternalServerErrorResponse({
    description: 'Failed to fetch traffic data.',
    type: ErrorResponseDto,
    example: {
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'Failed to fetch traffic data',
    },
  })
  @ApiParam({ name: 'dev_eui', description: 'Device dev_eui' })
  @ApiQuery({
    name: 'start',
    required: false,
    description: 'ISO 8601 date/time. Defaults to 24 hours before end/now.',
    schema: {
      type: 'string',
      default: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    },
    example: '2024-01-01T00:00:00Z',
  })
  @ApiQuery({
    name: 'end',
    required: false,
    description: 'ISO 8601 date/time. Defaults to now (page loaded time).',
    schema: { type: 'string', default: new Date().toISOString() },
    example: '2024-01-02T00:00:00Z',
  })
  @ApiQuery({
    name: 'timezone',
    required: false,
    description: 'IANA timezone (e.g., Asia/Tokyo). Defaults to UTC.',
    schema: { type: 'string', default: 'UTC' },
    example: 'UTC',
  })
  findOne(
    @Param('dev_eui') devEui: string,
    @Req() req,
    @Query('start') start?: string,
    @Query('end') end?: string,
    @Query('timezone') timezone?: string,
  ) {
    if (!devEui) {
      throw new BadRequestException('dev_eui is required');
    }

    const endDate = end ? new Date(end) : new Date();
    if (Number.isNaN(endDate.getTime())) {
      throw new BadRequestException('end must be a valid date/time');
    }

    const startDate = start
      ? new Date(start)
      : new Date(endDate.getTime() - 24 * 60 * 60 * 1000);
    if (Number.isNaN(startDate.getTime())) {
      throw new BadRequestException('start must be a valid date/time');
    }
    if (startDate > endDate) {
      throw new BadRequestException('start must be before end');
    }

    return this.trafficService.findOne(
      devEui,
      startDate,
      endDate,
      req.user,
      timezone,
    );
  }

  @Get(':dev_eui/monthly')
  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({
    description: 'Monthly traffic report returned successfully.',
    type: TrafficMonthlyReportDto,
    isArray: true,
  })
  @ApiBadRequestResponse({
    description: 'Invalid dev_eui, year, month, or timezone.',
    type: ErrorResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid bearer token.',
    type: ErrorResponseDto,
  })
  @ApiInternalServerErrorResponse({
    description: 'Failed to fetch monthly traffic report.',
    type: ErrorResponseDto,
  })
  @ApiParam({ name: 'dev_eui', description: 'Device dev_eui' })
  @ApiQuery({ name: 'year', description: 'Report year (e.g. 2026)', type: Number, example: 2026 })
  @ApiQuery({ name: 'month', description: 'Report month (1-12)', type: Number, example: 3 })
  @ApiQuery({
    name: 'timezone',
    required: false,
    description: 'IANA timezone. Defaults to Asia/Tokyo.',
    schema: { type: 'string', default: 'Asia/Tokyo' },
    example: 'Asia/Tokyo',
  })
  getMonthlyReport(
    @Param('dev_eui') devEui: string,
    @Query() query: TrafficReportDto,
    @Req() req,
  ) {
    if (!devEui) {
      throw new BadRequestException('dev_eui is required');
    }
    return this.trafficService.getMonthlyReport(
      devEui,
      query.year,
      query.month,
      req.user,
      query.timezone,
    );
  }
}
