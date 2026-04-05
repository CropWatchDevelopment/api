import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Patch,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiSecurity,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../v1/auth/guards/jwt.auth.guard';
import { PulseRelayDto } from './dto/pulse-relay.dto';
import { UpdateRelayDto } from './dto/update-relay.dto';
import { RelayService } from './relay.service';

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function maskHeaderValue(value: unknown): string {
  const normalized = readString(value);
  if (!normalized) {
    return 'missing';
  }

  if (normalized.length <= 12) {
    return `present(len=${normalized.length})`;
  }

  return `${normalized.slice(0, 6)}...${normalized.slice(-4)} (len=${normalized.length})`;
}

function summarizeTtiUpPayload(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {
      payloadType: typeof payload,
    };
  }

  const record = payload as Record<string, unknown>;
  const data =
    record.data && typeof record.data === 'object' && !Array.isArray(record.data)
      ? (record.data as Record<string, unknown>)
      : record;
  const endDeviceIds =
    data?.end_device_ids &&
    typeof data.end_device_ids === 'object' &&
    !Array.isArray(data.end_device_ids)
      ? (data.end_device_ids as Record<string, unknown>)
      : null;
  const uplinkMessage =
    data?.uplink_message &&
    typeof data.uplink_message === 'object' &&
    !Array.isArray(data.uplink_message)
      ? (data.uplink_message as Record<string, unknown>)
      : null;
  const decodedPayload =
    uplinkMessage?.decoded_payload &&
    typeof uplinkMessage.decoded_payload === 'object' &&
    !Array.isArray(uplinkMessage.decoded_payload)
      ? (uplinkMessage.decoded_payload as Record<string, unknown>)
      : null;

  return {
    applicationId:
      endDeviceIds?.application_ids &&
      typeof endDeviceIds.application_ids === 'object' &&
      !Array.isArray(endDeviceIds.application_ids)
        ? readString(
            (endDeviceIds.application_ids as Record<string, unknown>)
              .application_id,
          ) || undefined
        : undefined,
    correlationIdsCount: Array.isArray(data?.correlation_ids)
      ? data.correlation_ids.length
      : Array.isArray(record.correlation_ids)
        ? record.correlation_ids.length
        : 0,
    decodedPayloadKeys: decodedPayload
      ? Object.keys(decodedPayload).slice(0, 20)
      : [],
    devAddr: readString(endDeviceIds?.dev_addr) || undefined,
    devEui: readString(endDeviceIds?.dev_eui) || undefined,
    deviceId: readString(endDeviceIds?.device_id) || undefined,
    hasData: Boolean(data),
    hasDecodedPayload: Boolean(decodedPayload),
    hasUplinkMessage: Boolean(uplinkMessage),
    payloadKeys: Object.keys(record),
    receivedAt:
      readString(data?.received_at) ||
      readString(uplinkMessage?.received_at) ||
      readString(record.time) ||
      undefined,
  };
}

@ApiBearerAuth('bearerAuth')
@ApiSecurity('apiKey')
@Controller({ path: 'relay', version: '1' })
export class RelayController {
  private readonly logger = new Logger(RelayController.name);

  constructor(private readonly relayService: RelayService) {}

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
    @Req() req?: any,
  ) {
    this.logger.log(
      `[tti/up] webhook received ${JSON.stringify({
        contentType: readString(req?.headers?.['content-type']) || undefined,
        forwardedFor: readString(req?.headers?.['x-forwarded-for']) || undefined,
        method: req?.method,
        path: req?.originalUrl || req?.url,
        payload: summarizeTtiUpPayload(payload),
        tokenHeaders: {
          authorization: maskHeaderValue(authorizationHeader),
          xDownlinkApikey: maskHeaderValue(downlinkApiKeyHeader),
        },
        userAgent: readString(req?.headers?.['user-agent']) || undefined,
      })}`,
    );

    return this.relayService.handleTtiUp(
      payload,
      authorizationHeader,
      downlinkApiKeyHeader,
    );
  }
}
