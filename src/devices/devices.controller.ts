import { BadRequestException, Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { DevicesService } from './devices.service';
import { JwtAuthGuard } from '../auth/guards/jwt.auth.guard';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiSecurity,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { DeviceDto } from './dto/device.dto';

@Controller('devices')
@ApiBearerAuth('bearerAuth')
@ApiSecurity('apiKey')
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({ description: "Current user's devices returned successfully.", type: DeviceDto, isArray: true })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid bearer token.',
    type: ErrorResponseDto,
    example: { statusCode: 401, error: 'Unauthorized', message: 'Unauthorized' },
  })
  @ApiInternalServerErrorResponse({
    description: 'Failed to fetch devices.',
    type: ErrorResponseDto,
    example: { statusCode: 500, error: 'Internal Server Error', message: 'Failed to fetch devices' },
  })
  findAll(@Req() req) {
    return this.devicesService.findAll(req.user);
  }

  @Get(':dev_eui')
  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({ description: "Current user's device returned successfully.", type: DeviceDto })
  @ApiBadRequestResponse({
    description: 'Invalid dev_eui.',
    type: ErrorResponseDto,
    example: { statusCode: 400, error: 'Bad Request', message: 'dev_eui is required' },
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid bearer token.',
    type: ErrorResponseDto,
    example: { statusCode: 401, error: 'Unauthorized', message: 'Unauthorized' },
  })
  @ApiNotFoundResponse({
    description: 'Device not found.',
    type: ErrorResponseDto,
    example: { statusCode: 404, error: 'Not Found', message: 'Device not found' },
  })
  @ApiInternalServerErrorResponse({
    description: 'Failed to fetch device.',
    type: ErrorResponseDto,
    example: { statusCode: 500, error: 'Internal Server Error', message: 'Failed to fetch device' },
  })
  @ApiParam({ name: 'dev_eui', description: 'Device dev_eui' })
  findOne(@Req() req, @Param('dev_eui') devEui: string) {
    if (!devEui?.trim()) {
      throw new BadRequestException('dev_eui is required');
    }
    return this.devicesService.findOne(req.user, devEui);
  }
}
