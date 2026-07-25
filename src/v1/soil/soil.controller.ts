import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SoilService } from './soil.service';
import { SoilDataDto } from './dto/soil-data.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.auth.guard';
import { parseTimeseriesRange } from '../common/timeseries-range.helper';
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
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/authenticated-user';

@Controller({ path: 'soil', version: '1' })
@ApiBearerAuth('bearerAuth')
@ApiSecurity('apiKey')
@UseGuards(JwtAuthGuard)
export class SoilController {
  constructor(private readonly soilService: SoilService) {}

  @Get(':dev_eui')
  @ApiOkResponse({
    description: 'Soil data returned successfully.',
    type: SoilDataDto,
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
    description: 'Failed to fetch soil data.',
    type: ErrorResponseDto,
    example: {
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'Failed to fetch soil data',
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
    @CurrentUser() user: AuthenticatedUser,
    @Query('start') start?: string,
    @Query('end') end?: string,
    @Query('timezone') timezone?: string,
  ) {
    if (!devEui) {
      throw new BadRequestException('dev_eui is required');
    }

    const { startDate, endDate } = parseTimeseriesRange(start, end);

    return this.soilService.findOne(devEui, startDate, endDate, user, timezone);
  }
}
