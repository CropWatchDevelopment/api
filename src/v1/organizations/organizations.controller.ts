import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt.auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { OrganizationsService } from './organizations.service';
import {
  CreateInviteDto,
  CreateLinkRequestDto,
  UpdateMemberDto,
  UpdateOrgDto,
} from './dto/organizations.dtos';

@Controller({ path: 'orgs', version: '1' })
@ApiBearerAuth('bearerAuth')
@ApiSecurity('apiKey')
@UseGuards(JwtAuthGuard)
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Get(':orgId')
  @ApiOperation({ summary: "An organization's basics and the caller's role" })
  getOrg(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orgId', new ParseUUIDPipe()) orgId: string,
  ) {
    return this.organizationsService.getOrg(user, orgId);
  }

  @Patch(':orgId')
  @ApiOperation({ summary: 'Rename the organization (owner only)' })
  renameOrg(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orgId', new ParseUUIDPipe()) orgId: string,
    @Body() dto: UpdateOrgDto,
  ) {
    return this.organizationsService.renameOrg(user, orgId, dto.name);
  }

  @Post(':orgId/upgrade')
  @ApiOperation({ summary: 'Convert a personal org to a company (owner only)' })
  upgradeOrg(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orgId', new ParseUUIDPipe()) orgId: string,
    @Body() dto: UpdateOrgDto,
  ) {
    return this.organizationsService.upgradeOrg(user, orgId, dto.name);
  }

  // --- members -------------------------------------------------------------

  @Get(':orgId/members')
  listMembers(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orgId', new ParseUUIDPipe()) orgId: string,
  ) {
    return this.organizationsService.listMembers(user, orgId);
  }

  @Patch(':orgId/members/:userId')
  updateMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orgId', new ParseUUIDPipe()) orgId: string,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body() dto: UpdateMemberDto,
  ) {
    return this.organizationsService.updateMember(user, orgId, userId, dto);
  }

  @Post(':orgId/members/:userId/suspend')
  suspendMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orgId', new ParseUUIDPipe()) orgId: string,
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ) {
    return this.organizationsService.suspendMember(user, orgId, userId);
  }

  @Post(':orgId/members/:userId/reinstate')
  reinstateMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orgId', new ParseUUIDPipe()) orgId: string,
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ) {
    return this.organizationsService.reinstateMember(user, orgId, userId);
  }

  @Delete(':orgId/members/:userId')
  @ApiOperation({ summary: 'Remove a member, or leave the organization' })
  removeMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orgId', new ParseUUIDPipe()) orgId: string,
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ) {
    return this.organizationsService.removeMember(user, orgId, userId);
  }

  // --- invites -------------------------------------------------------------

  @Post(':orgId/invites')
  createInvite(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orgId', new ParseUUIDPipe()) orgId: string,
    @Body() dto: CreateInviteDto,
  ) {
    return this.organizationsService.createInvite(user, orgId, dto);
  }

  @Get(':orgId/invites')
  listInvites(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orgId', new ParseUUIDPipe()) orgId: string,
  ) {
    return this.organizationsService.listInvites(user, orgId);
  }

  @Delete(':orgId/invites/:inviteId')
  revokeInvite(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orgId', new ParseUUIDPipe()) orgId: string,
    @Param('inviteId', new ParseUUIDPipe()) inviteId: string,
  ) {
    return this.organizationsService.revokeInvite(user, orgId, inviteId);
  }

  @Post(':orgId/invites/:inviteId/resend')
  resendInvite(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orgId', new ParseUUIDPipe()) orgId: string,
    @Param('inviteId', new ParseUUIDPipe()) inviteId: string,
  ) {
    return this.organizationsService.resendInvite(user, orgId, inviteId);
  }

  // --- parent / sub-organizations ------------------------------------------

  @Get(':orgId/children')
  listChildren(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orgId', new ParseUUIDPipe()) orgId: string,
  ) {
    return this.organizationsService.listChildren(user, orgId);
  }

  @Post(':orgId/children/requests')
  createLinkRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orgId', new ParseUUIDPipe()) orgId: string,
    @Body() dto: CreateLinkRequestDto,
  ) {
    return this.organizationsService.createLinkRequest(user, orgId, dto);
  }

  @Get(':orgId/parent-requests')
  listParentRequests(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orgId', new ParseUUIDPipe()) orgId: string,
  ) {
    return this.organizationsService.listParentRequests(user, orgId);
  }

  @Post(':orgId/parent-requests/:requestId/accept')
  acceptParentRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orgId', new ParseUUIDPipe()) orgId: string,
    @Param('requestId', new ParseUUIDPipe()) requestId: string,
  ) {
    return this.organizationsService.decideParentRequest(
      user,
      orgId,
      requestId,
      true,
    );
  }

  @Post(':orgId/parent-requests/:requestId/decline')
  declineParentRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orgId', new ParseUUIDPipe()) orgId: string,
    @Param('requestId', new ParseUUIDPipe()) requestId: string,
  ) {
    return this.organizationsService.decideParentRequest(
      user,
      orgId,
      requestId,
      false,
    );
  }

  @Delete(':orgId/children/:childId')
  @ApiOperation({ summary: 'Unlink a child org (parent owner or staff)' })
  unlinkChild(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orgId', new ParseUUIDPipe()) orgId: string,
    @Param('childId', new ParseUUIDPipe()) childId: string,
  ) {
    return this.organizationsService.unlinkChild(user, orgId, childId);
  }
}
