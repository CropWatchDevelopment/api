import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiSecurity } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt.auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { OrganizationsService } from './organizations.service';

@Controller({ path: 'invites', version: '1' })
export class InvitesController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  /**
   * Public preview of an invite. Unauthenticated by design (the invitee may
   * have no account yet); throttled per client IP via the global
   * UserThrottlerGuard (trust proxy is pinned in main.ts), mirroring the
   * account-removal endpoints. The response masks the invitee email and
   * never confirms whether an account exists.
   */
  @Get(':token')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @ApiOperation({ summary: 'Public invite preview (masked, throttled)' })
  previewInvite(@Param('token') token: string) {
    return this.organizationsService.previewInvite(token);
  }

  @Post(':token/accept')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearerAuth')
  @ApiSecurity('apiKey')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @ApiOperation({
    summary:
      'Accept an invite (logged-in email must match; 409 while the caller holds another full membership or a non-empty personal org)',
  })
  acceptInvite(
    @CurrentUser() user: AuthenticatedUser,
    @Param('token') token: string,
  ) {
    return this.organizationsService.acceptInvite(user, token);
  }
}
