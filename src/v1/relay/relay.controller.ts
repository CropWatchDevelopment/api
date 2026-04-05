import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiSecurity,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { JwtAuthGuard } from '../../v1/auth/guards/jwt.auth.guard';
import { PulseRelayDto } from './dto/pulse-relay.dto';
import { UpdateRelayDto } from './dto/update-relay.dto';
import { RelayService } from './relay.service';

@ApiBearerAuth('bearerAuth')
@ApiSecurity('apiKey')
@Controller({ path: 'relay', version: '1' })
export class RelayController {
  constructor(private readonly relayService: RelayService) {}

  @Get(':dev_eui')
  @UseGuards(JwtAuthGuard)
  @ApiParam({ name: 'dev_eui', description: 'Device dev_eui' })
  @ApiOkResponse({
    description: 'Latest relay state returned successfully.',
  })
  @ApiBadRequestResponse({
    description: 'Invalid dev_eui.',
    type: ErrorResponseDto,
    example: {
      statusCode: 400,
      error: 'Bad Request',
      message: 'dev_eui is required',
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid bearer token.',
    type: ErrorResponseDto,
    example: {
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Missing bearer token',
    },
  })
  @ApiNotFoundResponse({
    description: 'Device or relay data not found.',
    type: ErrorResponseDto,
    example: {
      statusCode: 404,
      error: 'Not Found',
      message: 'Latest relay data not found',
    },
  })
  @ApiInternalServerErrorResponse({
    description: 'Failed to fetch relay data.',
    type: ErrorResponseDto,
    example: {
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'Failed to fetch relay data',
    },
  })
  @ApiOperation({
    summary: 'Get the latest relay values for a device',
  })
  getLatestRelay(@Param('dev_eui') devEui: string, @Req() req) {
    if (!devEui?.trim()) {
      throw new BadRequestException('dev_eui is required');
    }

    const authHeader = req.headers?.authorization;
    if (!authHeader) {
      throw new UnauthorizedException('Missing bearer token');
    }

    return this.relayService.getLatestRelay(
      req.user,
      authHeader,
      devEui,
    );
  }

  @Patch(':dev_eui')
  @UseGuards(JwtAuthGuard)
  @ApiParam({ name: 'dev_eui', description: 'Device dev_eui' })
  @ApiBody({ type: UpdateRelayDto })
  @ApiOkResponse({
    description:
      'Queues a relay command in TTI and waits until a confirmed relay uplink is written to cw_relay_data.',
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid bearer token.',
  })
  @ApiOperation({
    summary: 'Update a relay and wait for TTI confirmation',
  })
  updateRelay(
    @Param('dev_eui') devEui: string,
    @Body() updateRelayDto: UpdateRelayDto,
    @Req() req,
  ) {
    const authHeader = req.headers?.authorization;
    if (!authHeader) {
      throw new UnauthorizedException('Missing bearer token');
    }

    return this.relayService.updateRelay(
      req.user,
      authHeader,
      devEui,
      updateRelayDto,
    );
  }

  @Post(':dev_eui/pulse')
  @UseGuards(JwtAuthGuard)
  @ApiParam({ name: 'dev_eui', description: 'Device dev_eui' })
  @ApiBody({ type: PulseRelayDto })
  @ApiOkResponse({
    description:
      'Queues a timed relay pulse command in TTI for a relay that is currently off.',
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid bearer token.',
  })
  @ApiOperation({
    summary: 'Turn a relay on for a fixed number of seconds, then let it revert',
  })
  pulseRelay(
    @Param('dev_eui') devEui: string,
    @Body() pulseRelayDto: PulseRelayDto,
    @Req() req,
  ) {
    const authHeader = req.headers?.authorization;
    if (!authHeader) {
      throw new UnauthorizedException('Missing bearer token');
    }

    return this.relayService.pulseRelay(
      req.user,
      authHeader,
      devEui,
      pulseRelayDto,
    );
  }

  @Post('tti/up')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Receive TTI relay confirmation uplinks',
  })
  @ApiOkResponse({
    description:
      'Parses the TTI uplink payload and writes the confirmed relay state to cw_relay_data.',
  })
  handleTtiUp(
    @Body() payload: unknown,
    @Headers('authorization') authorizationHeader?: string,
    @Headers('x-downlink-apikey') downlinkApiKeyHeader?: string,
  ) {
    return this.relayService.handleTtiUp(
      payload,
      authorizationHeader,
      downlinkApiKeyHeader,
    );
  }
}
