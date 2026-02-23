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
} from '@nestjs/common';
import { WaterService } from './water.service';
import { WaterDataDto } from './dto/water-data.dto';
import type { CreateWaterDto } from './dto/create-water.dto';
import type { UpdateWaterDto } from './dto/update-water.dto';
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

@Controller('water')
@ApiBearerAuth('bearerAuth')
@ApiSecurity('apiKey')
export class WaterController {
  constructor(private readonly waterService: WaterService) {}

  // @Post()
  // create(@Body() createWaterDto: CreateWaterDto) {
  //   return this.waterService.create(createWaterDto);
  // }

  @Get(':dev_eui')
  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({
    description: 'Water data returned successfully.',
    type: WaterDataDto,
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
    description: 'Failed to fetch water data.',
    type: ErrorResponseDto,
    example: {
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'Failed to fetch water data',
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

    return this.waterService.findOne(devEui, startDate, endDate, timezone);
  }
}
