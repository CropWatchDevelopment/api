import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Delete,
} from '@nestjs/common';
import { AirService } from './air.service';
import { AirDataDto } from './dto/air-data.dto';
import { CreateAirAnnotationDto } from './dto/create-air-annotation.dto';
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
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/authenticated-user';

@Controller({ path: 'air', version: '1' })
@ApiBearerAuth('bearerAuth')
@ApiSecurity('apiKey')
@UseGuards(JwtAuthGuard)
export class AirController {
  constructor(private readonly airService: AirService) {}

  @Post('notes')
  async createNote(
    @Body() createAirNoteDto: CreateAirAnnotationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.airService.createNote(createAirNoteDto, user);
  }

  @Get('notes/:dev_eui/month/:month/year/:year')
  async findAll(
    @Param('dev_eui') devEui: string,
    @Param('month') month: string,
    @Param('year') year: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.airService.findAllNotes(devEui, month, year, user);
  }

  @Delete('notes/:note_id')
  async deleteNote(@Param('note_id') noteId: number, @CurrentUser() user: AuthenticatedUser) {
    return this.airService.deleteNote(noteId, user);
  }

  @Get(':dev_eui')
  @ApiOkResponse({
    description: 'Air data returned successfully.',
    type: AirDataDto,
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
    description: 'Failed to fetch air data.',
    type: ErrorResponseDto,
    example: {
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'Failed to fetch air data',
    },
  })
  @ApiParam({ name: 'dev_eui', description: 'Device dev_eui' })
  @ApiQuery({
    name: 'start',
    required: false,
    description: 'ISO 8601 date/time. Defaults to now (page loaded time).',
    schema: {
      type: 'string',
      default: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    }, // SHOULD be the date in ISO 8601, minus 24 hours
    example: '2024-01-01T00:00:00Z',
  })
  @ApiQuery({
    name: 'end',
    required: false,
    description: 'ISO 8601 date/time. Defaults to now (page loaded time).',
    schema: { type: 'string', default: new Date().toISOString() }, // SHOULD be NOW in ISO 8601
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

    return this.airService.findOne(
      devEui,
      startDate,
      endDate,
      user,
      timezone,
    );
  }
}
