import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt.auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { OverviewService } from './overview.service';
import { OverviewQueryDto } from './dto/overview-query.dto';
import { OverviewDto } from './dto/overview.dto';

@ApiBearerAuth('bearerAuth')
@ApiSecurity('apiKey')
@Controller({ path: 'overview', version: '1' })
@UseGuards(JwtAuthGuard)
export class OverviewController {
  constructor(private readonly overviewService: OverviewService) {}

  @Get()
  @ApiOperation({
    summary: 'System overview for the caller',
    description:
      'Device, gateway, alert, report and uplink totals, the hourly share of devices reporting, a per-location breakdown, notes and an activity feed for every device the caller can view. Pre-aggregated by a 10-minute database job (033_overview.sql), so a 30-day range costs about the same as 24 hours.',
  })
  @ApiOkResponse({ type: OverviewDto })
  @ApiBadRequestResponse({
    description: 'range is not 24h, 7d or 30d.',
    type: ErrorResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid bearer token.',
    type: ErrorResponseDto,
  })
  // The data behind it refreshes every 10 minutes; Vary keeps a shared
  // browser from serving one account's overview to the next.
  @Header('Cache-Control', 'private, max-age=300')
  @Header('Vary', 'Authorization')
  getOverview(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: OverviewQueryDto,
  ): Promise<OverviewDto> {
    return this.overviewService.getOverview(user, query.range ?? '24h');
  }
}
