import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
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
  type PushRecipientCandidate,
  type PushTokenSummary,
} from './push.service';
import { RegisterPushTokenDto } from './dto/register-push-token.dto';

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
  @ApiOperation({ summary: "List the current user's registered push tokens" })
  listTokens(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PushTokenSummary[]> {
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
