import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  AccountRemovalService,
  type AccountRemovalChallenge,
} from './account-removal.service';
import { RequestAccountRemovalDto } from './dto/request-account-removal.dto';

// Public, unauthenticated endpoints. Anonymous callers are IP-keyed by
// UserThrottlerGuard (trust proxy is pinned in main.ts), so these tight
// per-route limits track the real client, not Vercel's shared egress —
// provided the browser calls the API directly rather than via SSR.
@ApiTags('account-removal')
@Controller({ path: 'account-removal', version: '1' })
export class AccountRemovalController {
  constructor(
    private readonly accountRemovalService: AccountRemovalService,
  ) {}

  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Get('challenge')
  @ApiOperation({
    summary: 'Issue a human-verification math challenge (public)',
  })
  getChallenge(): AccountRemovalChallenge {
    return this.accountRemovalService.createChallenge();
  }

  @Throttle({ default: { ttl: 60_000, limit: 3 } })
  @Post('request')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary:
      'Submit an account removal request (public; emails the operators)',
  })
  async submitRequest(
    @Body() body: RequestAccountRemovalDto,
  ): Promise<{ requested: boolean }> {
    this.accountRemovalService.verifyChallenge(body.answer, body.token);
    await this.accountRemovalService.sendRemovalRequest(
      body.email,
      body.message,
    );
    return { requested: true };
  }
}
