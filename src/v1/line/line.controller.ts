import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt.auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import {
  LineService,
  type LineRecipientCandidate,
  type LineWebhookEvent,
} from './line.service';

@ApiTags('line')
@Controller({ path: 'line', version: '1' })
export class LineController {
  constructor(private readonly lineService: LineService) {}

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Receive LINE Messaging API webhook events (signature-verified)',
  })
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-line-signature') signature: string | undefined,
  ): Promise<{ received: boolean }> {
    const rawBody: Buffer | undefined = req.rawBody;
    if (!rawBody) {
      throw new BadRequestException('Missing webhook body');
    }

    this.lineService.verifyWebhookSignature(rawBody, signature);

    let events: LineWebhookEvent[] = [];
    try {
      const parsed = JSON.parse(rawBody.toString('utf8')) as {
        events?: LineWebhookEvent[];
      };
      events = Array.isArray(parsed.events) ? parsed.events : [];
    } catch {
      throw new BadRequestException('Malformed webhook body');
    }

    // Light events (a few HTTP calls at most); processed inline before the
    // response — LINE tolerates seconds and redelivers on failure.
    await this.lineService.handleEvents(events);
    return { received: true };
  }

  @Post('link-start')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Mint a nonce for the LINE account-link dialog redirect',
  })
  linkStart(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ nonce: string }> {
    return this.lineService.createLinkNonce(user.sub);
  }

  @Get('recipients')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'List users eligible as LINE recipients for the given devices',
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
  ): Promise<LineRecipientCandidate[]> {
    const parsed = (devEuis ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    if (parsed.length === 0) {
      throw new BadRequestException('devEuis is required');
    }
    return this.lineService.listEligibleRecipients(user, parsed);
  }

  @Post('link-code')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Mint a 6-digit code the user sends to the LINE bot to link',
  })
  linkCode(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ code: string; expiresAt: string }> {
    return this.lineService.createLinkCode(user.sub);
  }

  @Delete('link')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Unlink the LINE account from the current user' })
  async unlink(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.lineService.unlink(user.sub);
  }
}
