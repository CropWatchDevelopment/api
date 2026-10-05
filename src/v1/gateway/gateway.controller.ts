import {
  BadRequestException,
  Controller,
  Get,
  Param,
  UseGuards,
} from '@nestjs/common';
import { GatewayService } from './gateway.service';
import { JwtAuthGuard } from '../auth/guards/jwt.auth.guard';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiSecurity,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { GatewayDto } from './dto/gateway.dto';
import { DeviceGatewayDto } from './dto/device-gateway.dto';
import { GatewayDevicesResponseDto } from './dto/gateway-device.dto';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/authenticated-user';

@ApiBearerAuth('bearerAuth')
@ApiSecurity('apiKey')
@Controller({ path: 'gateway', version: '1' })
@UseGuards(JwtAuthGuard)
export class GatewayController {
  constructor(private readonly gatewayService: GatewayService) {}

  @Get()
  @ApiOperation({
    summary: 'Get gateways visible to the authenticated user',
    description:
      'Returns gateways the caller owns (cw_gateways_owners), gateways of an org they own or manage, and public gateways. Staff see every gateway.',
  })
  @ApiOkResponse({
    description: 'Visible gateways returned successfully.',
    type: GatewayDto,
    isArray: true,
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid bearer token.',
    type: ErrorResponseDto,
  })
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.gatewayService.findAll(user);
  }

  // by-device is declared before ':gatewayId' so it is not captured as a
  // gateway id.
  @Get('by-device/:devEui')
  @ApiOperation({
    summary: 'Get the gateways that heard a device',
    description:
      'Returns every cw_device_gateway row for the device, newest first. Gateways the caller cannot view (or that are not registered in CropWatch) are anonymized.',
  })
  @ApiParam({ name: 'devEui', description: 'cw_devices.dev_eui' })
  @ApiOkResponse({
    description: 'Device gateways returned successfully.',
    type: DeviceGatewayDto,
    isArray: true,
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid bearer token.',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Device not found or not readable by the caller.',
    type: ErrorResponseDto,
  })
  findByDevice(
    @Param('devEui') devEui: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!devEui?.trim()) {
      throw new BadRequestException('dev_eui is required');
    }
    return this.gatewayService.findByDevice(devEui, user);
  }

  @Get(':gatewayId')
  @ApiOperation({
    summary: 'Get a gateway visible to the authenticated user',
    description:
      'Returns a gateway the caller owns, manages through their org, or that is public. Staff see every gateway.',
  })
  @ApiParam({
    name: 'gatewayId',
    description: 'cw_gateways.gateway_id',
  })
  @ApiOkResponse({
    description: 'Gateway returned successfully.',
    type: GatewayDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid bearer token.',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description:
      'Gateway not found or not accessible to the authenticated user.',
    type: ErrorResponseDto,
  })
  findOne(
    @Param('gatewayId') gatewayId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!gatewayId?.trim()) {
      throw new BadRequestException('gateway_id is required');
    }

    return this.gatewayService.findOne(gatewayId, user);
  }

  @Get(':gatewayId/devices')
  @ApiOperation({
    summary: 'Get the devices recently heard through a gateway',
    description:
      'Devices heard within the connected window (24 h). Devices the caller can read are listed newest first; the rest are only counted in other_device_count.',
  })
  @ApiParam({ name: 'gatewayId', description: 'cw_gateways.gateway_id' })
  @ApiOkResponse({
    description: 'Gateway devices returned successfully.',
    type: GatewayDevicesResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid bearer token.',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description:
      'Gateway not found or not accessible to the authenticated user.',
    type: ErrorResponseDto,
  })
  findDevices(
    @Param('gatewayId') gatewayId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!gatewayId?.trim()) {
      throw new BadRequestException('gateway_id is required');
    }
    return this.gatewayService.findDevices(gatewayId, user);
  }
}
