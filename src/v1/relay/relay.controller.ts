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
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiSecurity,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { parseTimeseriesRange } from '../common/timeseries-range.helper';
import { JwtAuthGuard } from '../../v1/auth/guards/jwt.auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/authenticated-user';
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
  getLatestRelay(
    @Param('dev_eui') devEui: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!devEui?.trim()) {
      throw new BadRequestException('dev_eui is required');
    }

    return this.relayService.getLatestRelay(user, devEui);
  }

  @Get(':dev_eui/history')
  @UseGuards(JwtAuthGuard)
  @ApiParam({ name: 'dev_eui', description: 'Device dev_eui' })
  @ApiQuery({
    name: 'start',
    required: false,
    description: 'ISO 8601 date/time. Defaults to 24 hours before end.',
    example: '2026-10-10T00:00:00Z',
  })
  @ApiQuery({
    name: 'end',
    required: false,
    description:
      'ISO 8601 date/time. Defaults to now. At most 31 days after start.',
    example: '2026-10-11T00:00:00Z',
  })
  @ApiOkResponse({
    description:
      'Relay timeline, newest first: state changes the device reported (`kind: state_change`) and commands sent from CropWatch (`kind: command`) with who sent them and whether the device confirmed them (`outcome`). Empty ranges return [].',
  })
  @ApiBadRequestResponse({
    description:
      'Invalid dev_eui or range (bad dates, start after end, over 31 days).',
    type: ErrorResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid bearer token.',
  })
  @ApiOperation({
    summary: 'Get relay state changes and commands for a time range',
  })
  getRelayHistory(
    @Param('dev_eui') devEui: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('start') start?: string,
    @Query('end') end?: string,
  ) {
    if (!devEui?.trim()) {
      throw new BadRequestException('dev_eui is required');
    }

    return this.relayService.getRelayHistory(
      user,
      devEui,
      parseTimeseriesRange(start, end),
    );
  }

  @Patch(':dev_eui')
  @UseGuards(JwtAuthGuard)
  @ApiParam({ name: 'dev_eui', description: 'Device dev_eui' })
  @ApiBody({ type: UpdateRelayDto })
  @ApiOkResponse({
    description:
      'Queues a relay command in TTI. The device confirms with an uplink that the TTI webhook writes to cw_relay_data; rows received after `requestedAt` reflect the command.',
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid bearer token.',
  })
  @ApiOperation({
    summary: 'Send a relay command to the device',
  })
  updateRelay(
    @Param('dev_eui') devEui: string,
    @Body() updateRelayDto: UpdateRelayDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.relayService.updateRelay(user, devEui, updateRelayDto);
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
    summary:
      'Turn a relay on for a fixed number of seconds, then let it revert',
  })
  pulseRelay(
    @Param('dev_eui') devEui: string,
    @Body() pulseRelayDto: PulseRelayDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.relayService.pulseRelay(user, devEui, pulseRelayDto);
  }

  @Post(':dev_eui/status-request')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiParam({ name: 'dev_eui', description: 'Device dev_eui' })
  @ApiAcceptedResponse({
    description:
      'Asks the device to report its current relay state. Its uplink reaches cw_relay_data through the TTI webhook within seconds.',
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid bearer token.',
  })
  @ApiOperation({
    summary: 'Ask a relay device to report its state now',
  })
  requestRelayStatus(
    @Param('dev_eui') devEui: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.relayService.requestRelayStatus(user, devEui);
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
