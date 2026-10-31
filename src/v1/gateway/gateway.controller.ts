import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { GatewayService } from './gateway.service';
import { JwtAuthGuard } from '../auth/guards/jwt.auth.guard';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiSecurity,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { GatewayDto } from './dto/gateway.dto';
import {
  GatewayClaimDto,
  GatewayClaimResultDto,
} from './dto/gateway-claim.dto';
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

  @Post('claim')
  @HttpCode(200)
  // Bounds EUI probing (EUIs come in sequential batches).
  // blockDuration = ttl, or the counter would reset after the module's 30 s.
  @Throttle({
    default: { ttl: 3_600_000, limit: 30, blockDuration: 3_600_000 },
  })
  @ApiOperation({
    summary: 'Add a gateway to an account by its EUI',
    description: `
    Customers can add an unclaimed gateway that heard one of the devices they
    manage in the last 7 days; it is then claimed for their organization.
    Staff can add any gateway to any account (\`user_email\`). Errors carry a
    machine-readable \`code\`.
    `,
  })
  @ApiOkResponse({
    description: 'Gateway added, or the account could already see it.',
    type: GatewayClaimResultDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid bearer token.',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'STAFF_ONLY: user_email was sent by a non-staff caller.',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'GATEWAY_NOT_FOUND or USER_NOT_FOUND.',
    type: ErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'GATEWAY_CLAIMED or GATEWAY_AMBIGUOUS.',
    type: ErrorResponseDto,
  })
  @ApiUnprocessableEntityResponse({
    description: 'GATEWAY_NOT_HEARD: no device of yours was heard by it.',
    type: ErrorResponseDto,
  })
  claim(@CurrentUser() user: AuthenticatedUser, @Body() body: GatewayClaimDto) {
    return this.gatewayService.claim(user, body);
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
