import {
  Body,
  Controller,
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
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiSecurity,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../v1/auth/guards/jwt.auth.guard';
import { UpdateRelayDto } from './dto/update-relay.dto';
import { RelayService } from './relay.service';

@ApiBearerAuth('bearerAuth')
@ApiSecurity('apiKey')
@Controller({ path: 'relay', version: '1' })
export class RelayController {
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
