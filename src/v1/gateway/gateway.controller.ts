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
    summary: 'Get gateways for the authenticated user',
    description:
      'Returns all gateways where cw_gateways_owners links the gateway to the authenticated user.',
  })
  @ApiOkResponse({
    description: "Current user's gateways returned successfully.",
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

  @Get(':gatewayId')
  @ApiOperation({
    summary: 'Get a gateway for the authenticated user',
    description:
      'Returns a gateway only when cw_gateways_owners links that gateway to the authenticated user.',
  })
  @ApiParam({
    name: 'gatewayId',
    description: 'cw_gateways.gateway_id',
  })
  @ApiOkResponse({
    description: "Current user's gateway returned successfully.",
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
  findOne(@Param('gatewayId') gatewayId: string, @CurrentUser() user: AuthenticatedUser) {
    if (!gatewayId?.trim()) {
      throw new BadRequestException('gateway_id is required');
    }

    return this.gatewayService.findOne(gatewayId, user);
  }
}
