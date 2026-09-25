import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt.auth.guard';
import { StaffGuard } from '../auth/guards/staff.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { OrganizationsService } from './organizations.service';
import {
  AdminConvertOrgDto,
  AdminLinkOrgsDto,
  AdminSearchOrgsQueryDto,
  AdminTransferOwnershipDto,
} from './dto/organizations.dtos';

/** Staff-only org administration (search, convert, transfer, link/unlink). */
@Controller({ path: 'admin/orgs', version: '1' })
@ApiBearerAuth('bearerAuth')
@ApiSecurity('apiKey')
@UseGuards(JwtAuthGuard, StaffGuard)
export class AdminOrgsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Get()
  @ApiOperation({ summary: 'Search organizations (staff)' })
  search(@Query() query: AdminSearchOrgsQueryDto) {
    return this.organizationsService.adminSearchOrgs(
      query.q,
      query.include_deactivated ?? false,
    );
  }

  @Post(':orgId/convert')
  @ApiOperation({ summary: 'Convert a personal org to a company (staff)' })
  convert(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orgId', new ParseUUIDPipe()) orgId: string,
    @Body() dto: AdminConvertOrgDto,
  ) {
    return this.organizationsService.adminConvertOrg(user, orgId, dto.name);
  }

  @Post(':orgId/transfer-ownership')
  @ApiOperation({ summary: 'Transfer company ownership (staff)' })
  transfer(
    @Param('orgId', new ParseUUIDPipe()) orgId: string,
    @Body() dto: AdminTransferOwnershipDto,
  ) {
    return this.organizationsService.adminTransferOwnership(
      orgId,
      dto.new_owner_user_id,
    );
  }

  @Post('links')
  @ApiOperation({ summary: 'Link a child org under a parent (staff)' })
  link(@CurrentUser() user: AuthenticatedUser, @Body() dto: AdminLinkOrgsDto) {
    return this.organizationsService.adminLinkOrgs(
      user,
      dto.parent_org_id,
      dto.child_org_id,
    );
  }

  @Delete('links/:childOrgId')
  @ApiOperation({ summary: 'Unlink a child org from its parent (staff)' })
  unlink(@Param('childOrgId', new ParseUUIDPipe()) childOrgId: string) {
    return this.organizationsService.adminUnlinkOrg(childOrgId);
  }
}
