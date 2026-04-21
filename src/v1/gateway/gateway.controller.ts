import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { GatewayService } from './gateway.service';
import { CreateGatewayDto } from './dto/create-gateway.dto';
import { UpdateGatewayDto } from './dto/update-gateway.dto';
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

@ApiBearerAuth('bearerAuth')
@ApiSecurity('apiKey')
@Controller({ path: 'gateway', version: '1' })
export class GatewayController {
  constructor(private readonly gatewayService: GatewayService) {}

  @Post()
  create(@Body() createGatewayDto: CreateGatewayDto) {
    return this.gatewayService.create(createGatewayDto);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
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
  findAll(@Req() req) {
    return this.gatewayService.findAll(req.user);
  }

  @Get(':gatewayId')
  @UseGuards(JwtAuthGuard)
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
  findOne(@Param('gatewayId') gatewayId: string, @Req() req) {
    if (!gatewayId?.trim()) {
      throw new BadRequestException('gateway_id is required');
    }

    return this.gatewayService.findOne(gatewayId, req.user);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateGatewayDto: UpdateGatewayDto) {
    return this.gatewayService.update(+id, updateGatewayDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.gatewayService.remove(+id);
  }
}
