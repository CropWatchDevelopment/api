import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt.auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import {
  PushService,
  type PushDeviceSummary,
  type PushRecipientCandidate,
} from './push.service';
import { RefreshPushTokenDto } from './dto/refresh-push-token.dto';
import { RegisterPushTokenDto } from './dto/register-push-token.dto';

const DEVICE_ID_PATTERN = /^[0-9a-f]{64}$/;

@ApiTags('push')
@Controller({ path: 'push', version: '1' })
export class PushController {
  constructor(private readonly pushService: PushService) {}

  @Post('tokens')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Register (or refresh) an FCM push token for this device',
  })
  async registerToken(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: RegisterPushTokenDto,
  ): Promise<{ registered: boolean }> {
    await this.pushService.registerToken(
      user.sub,
      body.token,
      body.deviceLabel,
    );
    return { registered: true };
  }

  @Post('tokens/refresh')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Refresh this browser's push token on app load (never turns push on)",
  })
  async refreshToken(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: RefreshPushTokenDto,
  ): Promise<{ subscribed: boolean }> {
    const subscribed = await this.pushService.refreshToken(
      user.sub,
      body.token,
      body.previousToken,
      body.deviceLabel,
    );
    return { subscribed };
  }

  @Delete('tokens/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: "Remove one of the current user's push devices by its list id",
  })
  async removeDevice(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<void> {
    if (!DEVICE_ID_PATTERN.test(id)) {
      throw new BadRequestException('Invalid device id');
    }
    if (!(await this.pushService.removeDevice(user.sub, id))) {
      throw new NotFoundException('Push device not found');
    }
  }

  @Delete('tokens')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Unregister an FCM push token for this device' })
  @ApiQuery({
    name: 'token',
    required: true,
    type: String,
    description: 'FCM registration token to remove',
  })
  async unregisterToken(
    @CurrentUser() user: AuthenticatedUser,
    @Query('token') token?: string,
  ): Promise<void> {
    const trimmed = (token ?? '').trim();
    if (trimmed.length === 0) {
      throw new BadRequestException('token is required');
    }
    await this.pushService.unregisterToken(user.sub, trimmed);
  }

  @Get('tokens')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "List the current user's push devices" })
  listTokens(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PushDeviceSummary[]> {
    return this.pushService.listTokens(user.sub);
  }

  @Get('recipients')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'List users eligible as push recipients for the given devices',
  })
  @ApiQuery({
    name: 'devEuis',
    required: true,
    type: String,
    description: 'Comma-separated device EUIs',
  })
  listRecipients(
    @CurrentUser() user: AuthenticatedUser,
    @Query('devEuis') devEuis?: string,
  ): Promise<PushRecipientCandidate[]> {
    const parsed = (devEuis ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    if (parsed.length === 0) {
      throw new BadRequestException('devEuis is required');
    }
    return this.pushService.listEligibleRecipients(user, parsed);
  }
}
