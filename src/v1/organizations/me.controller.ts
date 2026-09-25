import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt.auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { OrganizationsService } from './organizations.service';

@Controller({ path: 'me', version: '1' })
@ApiBearerAuth('bearerAuth')
@ApiSecurity('apiKey')
@UseGuards(JwtAuthGuard)
export class MeController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Get('context')
  @ApiOperation({
    summary:
      "The caller's org standing: their org + role + capability list, guest seats, child orgs, and whether organizations are enabled",
  })
  getMeContext(@CurrentUser() user: AuthenticatedUser) {
    return this.organizationsService.getMeContext(user);
  }
}
