import { Controller, Get, Param, Query, Req, Res, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiSecurity,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt.auth.guard';
import { DashboardService } from './dashboard.service';
import { DashboardQuery } from './dashboard.types';

@Controller({ path: 'dashboard', version: '1' })
@ApiBearerAuth('bearerAuth')
@ApiSecurity('apiKey')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('devices')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Paginated list of devices the user can see, with latest primary/secondary readings',
  })
  @ApiQuery({ name: 'skip', required: false })
  @ApiQuery({ name: 'take', required: false })
  @ApiQuery({ name: 'group', required: false })
  @ApiQuery({ name: 'name', required: false })
  @ApiQuery({ name: 'location', required: false })
  @ApiQuery({ name: 'locationGroup', required: false })
  async getDevices(@Req() req: any, @Query() q: Record<string, string | undefined>) {
    const query: DashboardQuery = {
      skip: q.skip ? Number(q.skip) : undefined,
      take: q.take ? Number(q.take) : undefined,
      group: q.group?.trim() || undefined,
      name: q.name?.trim() || undefined,
      location: q.location?.trim() || undefined,
      locationGroup: q.locationGroup?.trim() || undefined,
    };
    return this.dashboardService.getDevices(req.user, req.headers.authorization, query);
  }

  @Get('locations')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Paginated list of locations the user can see, each with its devices and latest readings',
  })
  @ApiQuery({ name: 'skip', required: false })
  @ApiQuery({ name: 'take', required: false })
  @ApiQuery({ name: 'group', required: false })
  @ApiQuery({ name: 'name', required: false })
  @ApiQuery({ name: 'location', required: false })
  @ApiQuery({ name: 'locationGroup', required: false })
  async getLocations(@Req() req: any, @Query() q: Record<string, string | undefined>) {
    const query: DashboardQuery = {
      skip: q.skip ? Number(q.skip) : undefined,
      take: q.take ? Number(q.take) : undefined,
      group: q.group?.trim() || undefined,
      name: q.name?.trim() || undefined,
      location: q.location?.trim() || undefined,
      locationGroup: q.locationGroup?.trim() || undefined,
    };
    return this.dashboardService.getLocations(req.user, req.headers.authorization, query);
  }

  @Get('devices/:dev_eui/latest')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Latest full data row for a single device (all columns from its data_table_v2)',
  })
  @ApiParam({ name: 'dev_eui', required: true })
  async getLatest(
    @Req() req: any,
    @Param('dev_eui') devEui: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const row = await this.dashboardService.getLatest(req.user, devEui, req.headers.authorization);
    if (row === null) {
      res.status(204);
      return;
    }
    return row;
  }
}
