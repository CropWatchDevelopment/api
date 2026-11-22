import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiSecurity,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt.auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { CreateGroupDto, GroupDto, GroupNameDto } from './dto/group.dto';
import { GroupsService, type GroupKind } from './groups.service';

/**
 * The four group routes, shared by /v1/location-groups and /v1/device-groups
 * (separate pools). The device and location endpoints keep taking and
 * returning the group's name; these routes manage the groups themselves.
 */
abstract class GroupsControllerBase {
  protected constructor(
    private readonly groupsService: GroupsService,
    private readonly kind: GroupKind,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List the groups you can see',
    description:
      'The groups on the locations/devices you can access, every group of an organization you own or manage, and the unused groups you created (CropWatch staff: every group), in natural name order. A group belongs to an organization: one group per name per organization.',
  })
  @ApiQuery({
    name: 'org_id',
    required: false,
    description: 'Only the groups of this organization.',
  })
  @ApiHeader({
    name: 'accept-language',
    required: false,
    description:
      'Sort language for names: English (en…) or Japanese (default).',
  })
  @ApiOkResponse({ type: GroupDto, isArray: true })
  @ApiBadRequestResponse({
    description: 'org_id is not a UUID.',
    type: ErrorResponseDto,
  })
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query('org_id', new ParseUUIDPipe({ optional: true })) orgId?: string,
    @Headers('accept-language') acceptLanguage?: string,
  ): Promise<GroupDto[]> {
    return this.groupsService.list(this.kind, user, {
      orgId,
      locale: acceptLanguage,
    });
  }

  @Post()
  @ApiOperation({
    summary: 'Create a group',
    description:
      'Adds a group to an organization whose locations (or devices) you can edit. When the organization already has a group with this name, that group is returned. Pick it on a location or device by sending its name as `group`.',
  })
  @ApiCreatedResponse({ type: GroupDto })
  @ApiBadRequestResponse({
    description:
      'The name is empty or longer than 120 characters, or org_id is not a UUID.',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description:
      'You cannot edit any location (or device) of this organization.',
    type: ErrorResponseDto,
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateGroupDto,
  ): Promise<GroupDto> {
    return this.groupsService.create(this.kind, user, body.name, body.org_id);
  }

  @Patch(':id')
  @ApiParam({ name: 'id', description: 'Group id' })
  @ApiOperation({
    summary: 'Rename a group',
    description:
      'The organization’s owner and managers, CropWatch staff, and the group’s creator (while they can see it) can. Every location/device using the group shows the new name.',
  })
  @ApiOkResponse({ type: GroupDto })
  @ApiBadRequestResponse({
    description: 'The name is empty or longer than 120 characters.',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description:
      'You can see the group but are neither its creator nor an owner/manager of its organization.',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'No group with this id that you can see.',
    type: ErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'The organization already has a group with this name.',
    type: ErrorResponseDto,
  })
  rename(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: GroupNameDto,
  ): Promise<GroupDto> {
    return this.groupsService.rename(this.kind, user, id, body.name);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'id', description: 'Group id' })
  @ApiOperation({
    summary: 'Delete a group',
    description:
      'The organization’s owner and managers, CropWatch staff, and the group’s creator (while they can see it) can. Every location/device using the group is left without one.',
  })
  @ApiNoContentResponse({ description: 'Group deleted.' })
  @ApiForbiddenResponse({
    description:
      'You can see the group but are neither its creator nor an owner/manager of its organization.',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'No group with this id that you can see.',
    type: ErrorResponseDto,
  })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    return this.groupsService.remove(this.kind, user, id);
  }
}

@Controller({ path: 'location-groups', version: '1' })
@ApiBearerAuth('bearerAuth')
@ApiSecurity('apiKey')
@UseGuards(JwtAuthGuard)
@ApiUnauthorizedResponse({
  description: 'Missing or invalid bearer token.',
  type: ErrorResponseDto,
})
export class LocationGroupsController extends GroupsControllerBase {
  constructor(groupsService: GroupsService) {
    super(groupsService, 'location');
  }
}

@Controller({ path: 'device-groups', version: '1' })
@ApiBearerAuth('bearerAuth')
@ApiSecurity('apiKey')
@UseGuards(JwtAuthGuard)
@ApiUnauthorizedResponse({
  description: 'Missing or invalid bearer token.',
  type: ErrorResponseDto,
})
export class DeviceGroupsController extends GroupsControllerBase {
  constructor(groupsService: GroupsService) {
    super(groupsService, 'device');
  }
}
