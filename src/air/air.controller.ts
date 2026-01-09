import { BadRequestException, Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards } from '@nestjs/common';
import { AirService } from './air.service';
import { CreateAirDto } from './dto/create-air.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.auth.guard';
import { ApiBearerAuth, ApiParam, ApiQuery, ApiSecurity } from '@nestjs/swagger';

@Controller('air')
@ApiBearerAuth('bearerAuth')
@ApiSecurity('apiKey')
export class AirController {
  constructor(private readonly airService: AirService) {}

  // @Post()
  // create(@Body() createAirDto: CreateAirDto) {
  //   return this.airService.create(createAirDto);
  // }

  // @Get()
  // findAll() {
  //   return this.airService.findAll();
  // }

  @Get(':dev_eui')
  @UseGuards(JwtAuthGuard)
  @ApiParam({ name: 'dev_eui', description: 'Device dev_eui' })
  @ApiQuery({
    name: 'start',
    required: false,
    description: 'ISO 8601 date/time. Defaults to 24 hours before end/now.',
    schema: { type: 'string', default: 'now-24h' },
    example: '2024-01-01T00:00:00Z',
  })
  @ApiQuery({
    name: 'end',
    required: false,
    description: 'ISO 8601 date/time. Defaults to now.',
    schema: { type: 'string', default: 'now' },
    example: '2024-01-02T00:00:00Z',
  })
  @ApiQuery({
    name: 'timezone',
    required: false,
    description: 'IANA timezone (e.g., America/Chicago). Defaults to UTC.',
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

    return this.airService.findOne(devEui, startDate, endDate, timezone);
  }

}
