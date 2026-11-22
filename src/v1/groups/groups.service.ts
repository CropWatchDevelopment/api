import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import type { PostgrestError } from '@supabase/supabase-js';
import { SupabaseService } from '../../supabase/supabase.service';
import {
  AccessService,
  Action,
  LOCATION_OWNER_MATCH_EMBED,
  applyLocationManageScope,
  applyLocationReadScope,
  decide,
} from '../common/authz';
import { naturalSort } from '../common/natural-sort';
import { MANAGE_CEILING } from '../common/permission-levels';
import {
  selectAllPages,
  type PostgrestPage,
} from '../common/postgrest-pages.helper';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import type { GroupDto } from './dto/group.dto';

/** Devices and locations have separate pools of groups. */
export type GroupKind = 'location' | 'device';

interface GroupPool {
  table: 'cw_location_groups' | 'cw_device_groups';
  resource: 'cw_locations' | 'cw_devices';
}

const POOLS: Record<GroupKind, GroupPool> = {
  location: { table: 'cw_location_groups', resource: 'cw_locations' },
  device: { table: 'cw_device_groups', resource: 'cw_devices' },
};

const GROUP_COLUMNS = 'id, org_id, name, created_by';
const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';
const CHECK_VIOLATION = '23514';
/** Ids per `.in()` filter, so the request URL stays short. */
const ID_CHUNK = 100;
/** Locations tried per org before deciding the caller can edit none there. */
const EDIT_PROBES_PER_ORG = 10;

type GroupRow = {
  id: number;
  org_id: string | null;
  name: string;
  created_by: string | null;
};
type QueryResult<T> = { data: T | null; error: PostgrestError | null };

/** What the caller may see and manage, worked out once per call. */
interface Standing {
  /** Orgs the caller owns or manages: they see and manage all of their groups. */
  managedOrgIds: Set<string>;
  /** Groups on the locations/devices the caller can read. */
  attached: Set<number>;
}

/**
 * Device and location groups (supabase/updates/038_groups.sql).
 *
 * A group belongs to an organization: one group per name per org, used by that
 * org's locations (or devices). A user sees the groups on the locations/devices
 * they can access, every group of an org they own or manage, and the unused
 * groups they created in an org where they can still edit; staff see every
 * group. The org's owner and managers, staff, and the creator (while they can
 * see it) rename or delete a group.
 *
 * The device and location endpoints still take and return the group's name;
 * `resolveForWrite` turns a name into the group of that name in the resource's
 * org.
 */
@Injectable()
export class GroupsService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly accessService: AccessService,
  ) {}

  /** The groups the caller can see (of one org, when given), in natural name order. */
  async list(
    kind: GroupKind,
    user: AuthenticatedUser,
    options: { orgId?: string; locale?: string } = {},
  ): Promise<GroupDto[]> {
    const pool = POOLS[kind];
    const { orgId, locale } = options;

    let rows: GroupRow[];
    let standing: Standing | null = null;
    if (user.isStaff) {
      rows = await this.selectGroups(pool, { orgId });
    } else {
      standing = await this.standing(kind, user);
      const [own, orgGroups] = await Promise.all([
        this.selectGroups(pool, { createdBy: user.sub, orgId }),
        this.selectGroups(pool, {
          orgIds: [...standing.managedOrgIds].filter(
            (id) => orgId === undefined || id === orgId,
          ),
        }),
      ]);
      const ownUnused = await this.unused(pool, own);
      // An unused group stays the creator's only while they can still edit
      // in its org: after that it would only leak the org's group names.
      const editable =
        ownUnused.length > 0
          ? await this.editableOrgIds(kind, user)
          : new Set<string>();
      const byId = new Map<number, GroupRow>();
      for (const row of orgGroups) byId.set(row.id, row);
      for (const row of ownUnused) {
        if (row.org_id !== null && editable.has(row.org_id)) {
          byId.set(row.id, row);
        }
      }
      const missing = [...standing.attached].filter((id) => !byId.has(id));
      for (const row of await this.selectGroups(pool, { ids: missing })) {
        byId.set(row.id, row);
      }
      rows = [...byId.values()].filter(
        (row) => orgId === undefined || row.org_id === orgId,
      );
    }

    return naturalSort(
      rows
        .sort((a, b) => a.id - b.id)
        .map((row) => this.toDto(row, user, standing)),
      (group) => group.name,
      { locale },
    );
  }

  /**
   * Adds a group to an org whose locations (or devices) the caller can edit.
   * When the org already has a group of that name, that group is returned.
   */
  async create(
    kind: GroupKind,
    user: AuthenticatedUser,
    rawName: string,
    orgId: string,
  ): Promise<GroupDto> {
    const name = this.requireName(rawName);
    const pool = POOLS[kind];
    if (
      !user.isStaff &&
      !(await this.editableOrgIds(kind, user, orgId)).has(orgId)
    ) {
      throw new ForbiddenException(
        'You cannot add groups to this organization',
      );
    }

    let row = await this.findInOrg(pool, orgId, name);
    if (!row) {
      const { data, error } = (await this.supabaseService
        .getClient()
        .from(pool.table)
        .insert({ org_id: orgId, name, created_by: user.sub })
        .select(GROUP_COLUMNS)
        .single()) as QueryResult<GroupRow>;
      if (error?.code === UNIQUE_VIOLATION) {
        // Added by a concurrent request.
        row = await this.findInOrg(pool, orgId, name);
      } else if (error?.code === FOREIGN_KEY_VIOLATION) {
        throw new NotFoundException('Organization not found');
      } else if (error) {
        this.throwWriteError(error, 'Failed to create the group');
      } else {
        row = data;
      }
    }
    if (!row) {
      throw new InternalServerErrorException('Failed to create the group');
    }
    return this.toDto(
      row,
      user,
      user.isStaff ? null : await this.standing(kind, user),
    );
  }

  /** Renames a group (404 when the caller cannot see it, 403 when they cannot change it). */
  async rename(
    kind: GroupKind,
    user: AuthenticatedUser,
    id: number,
    rawName: string,
  ): Promise<GroupDto> {
    const name = this.requireName(rawName);
    const standing = await this.findManageable(kind, user, id);

    const { data, error } = (await this.supabaseService
      .getClient()
      .from(POOLS[kind].table)
      .update({ name, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select(GROUP_COLUMNS)
      .maybeSingle()) as QueryResult<GroupRow>;

    if (error?.code === UNIQUE_VIOLATION) {
      throw new ConflictException(
        'This organization already has a group with this name',
      );
    }
    if (error) {
      this.throwWriteError(error, 'Failed to rename the group');
    }
    if (!data) {
      throw new NotFoundException('Group not found');
    }
    return this.toDto(data, user, standing);
  }

  /**
   * Deletes a group. Every location/device using it is left without a group
   * (ON DELETE SET NULL).
   */
  async remove(
    kind: GroupKind,
    user: AuthenticatedUser,
    id: number,
  ): Promise<void> {
    await this.findManageable(kind, user, id);

    const { error } = await this.supabaseService
      .getClient()
      .from(POOLS[kind].table)
      .delete()
      .eq('id', id);

    if (error) {
      throw new InternalServerErrorException('Failed to delete the group');
    }
  }

  /**
   * The group id for a name sent to a device/location endpoint, whose
   * interface still carries the group as a string: empty → no group, else the
   * group of that name in the resource's org, created when the org has none
   * (API clients that send free text keep working). One group per name per
   * org, so re-saving a form keeps the resource's group and groups are never
   * shared across orgs.
   *
   * Call it only after the caller's right to write the resource was checked.
   * Name length is the endpoints' business: their DTOs keep the old limits.
   */
  async resolveForWrite(
    kind: GroupKind,
    user: AuthenticatedUser,
    rawName: string | null | undefined,
    /** The org the location/device is (or will be) in. */
    orgId: string | null,
  ): Promise<number | null> {
    const name = typeof rawName === 'string' ? rawName.trim() : '';
    if (name.length === 0) {
      return null;
    }
    const pool = POOLS[kind];

    const existing = await this.findInOrg(pool, orgId, name);
    if (existing) {
      return existing.id;
    }

    const { data, error } = (await this.supabaseService
      .getClient()
      .from(pool.table)
      .insert({ org_id: orgId, name, created_by: user.sub })
      .select('id')
      .single()) as QueryResult<{ id: number }>;
    if (error?.code === UNIQUE_VIOLATION) {
      // Created by a concurrent request.
      const raced = await this.findInOrg(pool, orgId, name);
      if (raced) {
        return raced.id;
      }
    }
    if (error) {
      this.throwWriteError(error, 'Failed to create the group');
    }
    if (!data) {
      throw new InternalServerErrorException('Failed to create the group');
    }
    return data.id;
  }

  private requireName(rawName: string): string {
    const name = typeof rawName === 'string' ? rawName.trim() : '';
    if (name.length === 0) {
      throw new BadRequestException('A group needs a name');
    }
    return name;
  }

  /** A name the table refuses is the caller's mistake (400); anything else a 500. */
  private throwWriteError(error: PostgrestError, message: string): never {
    if (error.code === CHECK_VIOLATION) {
      throw new BadRequestException('This group name is not allowed');
    }
    throw new InternalServerErrorException(message);
  }

  private toDto(
    row: GroupRow,
    user: AuthenticatedUser,
    /** null for staff, who manage every group. */
    standing: Standing | null,
  ): GroupDto {
    return {
      id: row.id,
      name: row.name,
      org_id: row.org_id,
      can_manage:
        standing === null ||
        (row.org_id !== null && standing.managedOrgIds.has(row.org_id)) ||
        row.created_by === user.sub,
    };
  }

  private async standing(
    kind: GroupKind,
    user: AuthenticatedUser,
  ): Promise<Standing> {
    const [managed, attached] = await Promise.all([
      this.accessService.getManagedOrgIds(user),
      this.attachedGroupIds(kind, user),
    ]);
    return { managedOrgIds: new Set(managed), attached };
  }

  /**
   * The group for rename/delete: staff and the org's owner/managers always,
   * its creator while they can still see it (on something they can read, or
   * unused in an org where they can still edit). 404 when the caller cannot
   * see the group, 403 when they see it but may not change it.
   */
  private async findManageable(
    kind: GroupKind,
    user: AuthenticatedUser,
    id: number,
  ): Promise<Standing | null> {
    const pool = POOLS[kind];
    const [row] = await this.selectGroups(pool, { ids: [id] });
    if (!row) {
      throw new NotFoundException('Group not found');
    }
    if (user.isStaff) {
      return null;
    }
    const standing = await this.standing(kind, user);
    if (row.org_id !== null && standing.managedOrgIds.has(row.org_id)) {
      return standing;
    }
    const createdHere = row.created_by === user.sub;
    const visible =
      standing.attached.has(id) ||
      (createdHere &&
        row.org_id !== null &&
        (await this.unused(pool, [row])).length > 0 &&
        (await this.editableOrgIds(kind, user, row.org_id)).has(row.org_id));
    if (visible && createdHere) {
      return standing;
    }
    if (visible) {
      throw new ForbiddenException(
        'Only the organization’s owner and managers, and the group’s creator, can rename or delete it',
      );
    }
    throw new NotFoundException('Group not found');
  }

  /**
   * Orgs where the caller can edit, so may add groups (and keep their unused
   * ones): orgs they own or manage, orgs with a location they can edit
   * (whoever edits a location can add devices there) and, for device groups,
   * orgs with a device they can edit. Each candidate location is confirmed
   * with the same access decision the location endpoints use (suspended or
   * expired memberships and the guest cap included). `onlyOrgId` narrows the
   * search to one org.
   */
  private async editableOrgIds(
    kind: GroupKind,
    user: AuthenticatedUser,
    onlyOrgId?: string,
  ): Promise<Set<string>> {
    const managedOrgIds = await this.accessService.getManagedOrgIds(user);
    const editable = new Set(managedOrgIds);
    if (kind === 'device') {
      for (const device of await this.accessService.listAccessibleDevices(
        user,
      )) {
        if (device.canManage && device.orgId !== null) {
          editable.add(device.orgId);
        }
      }
    }
    if (onlyOrgId !== undefined && editable.has(onlyOrgId)) {
      return editable;
    }

    const candidates = await selectAllPages<{
      location_id: number;
      org_id: string | null;
    }>((from, to) => {
      let query = this.supabaseService
        .getClient()
        .from('cw_locations')
        .select(`location_id, org_id, ${LOCATION_OWNER_MATCH_EMBED}`);
      if (onlyOrgId !== undefined) query = query.eq('org_id', onlyOrgId);
      query = applyLocationManageScope(
        query,
        user,
        MANAGE_CEILING,
        managedOrgIds,
      );
      return query
        .order('location_id', { ascending: true })
        .range(from, to) as PromiseLike<
        PostgrestPage<{ location_id: number; org_id: string | null }>
      >;
    }, 'Failed to check the organization');

    const tried = new Map<string, number>();
    for (const { location_id: locationId, org_id: orgId } of candidates) {
      if (orgId === null || editable.has(orgId)) continue;
      const attempts = tried.get(orgId) ?? 0;
      if (attempts >= EDIT_PROBES_PER_ORG) continue;
      tried.set(orgId, attempts + 1);
      const access = await this.accessService.getLocationAccess(
        user,
        locationId,
      );
      if (access.canRead && decide(access, Action.LocationEdit)) {
        editable.add(orgId);
      }
    }
    return editable;
  }

  private async findInOrg(
    pool: GroupPool,
    orgId: string | null,
    name: string,
  ): Promise<GroupRow | null> {
    let query = this.supabaseService
      .getClient()
      .from(pool.table)
      .select(GROUP_COLUMNS)
      .eq('name', name);
    query =
      orgId === null ? query.is('org_id', null) : query.eq('org_id', orgId);
    const { data, error } =
      (await query.maybeSingle()) as QueryResult<GroupRow>;
    if (error) {
      throw new InternalServerErrorException('Failed to look up the group');
    }
    return data;
  }

  /** Those of `groups` that no location/device uses. */
  private async unused(
    pool: GroupPool,
    groups: GroupRow[],
  ): Promise<GroupRow[]> {
    const used = new Set<number>();
    const ids = groups.map((group) => group.id);
    for (let i = 0; i < ids.length; i += ID_CHUNK) {
      const { data, error } = (await this.supabaseService
        .getClient()
        .from(pool.resource)
        .select('group_id')
        .in('group_id', ids.slice(i, i + ID_CHUNK))) as QueryResult<
        { group_id: number | null }[]
      >;
      if (error) {
        throw new InternalServerErrorException('Failed to fetch groups');
      }
      for (const row of data ?? []) {
        if (row.group_id !== null) used.add(row.group_id);
      }
    }
    return groups.filter((group) => !used.has(group.id));
  }

  /** Ids of the groups on the locations/devices the caller can see. */
  private async attachedGroupIds(
    kind: GroupKind,
    user: AuthenticatedUser,
  ): Promise<Set<number>> {
    if (kind === 'device') {
      // The same device set every device-access decision uses (including
      // location-grant defaults).
      const devices = await this.accessService.listAccessibleDevices(user);
      return new Set(
        devices
          .filter((device) => device.canView && device.groupId != null)
          .map((device) => device.groupId as number),
      );
    }

    // The same locations the caller sees in their location list.
    const readableOrgIds = await this.accessService.getReadableOrgIds(user);
    const rows = await selectAllPages<{ group_id: number | null }>(
      (from, to) => {
        let query = this.supabaseService
          .getClient()
          .from('cw_locations')
          .select(`group_id, ${LOCATION_OWNER_MATCH_EMBED}`)
          .not('group_id', 'is', null);
        query = applyLocationReadScope(query, user, readableOrgIds);
        return query
          .order('location_id', { ascending: true })
          .range(from, to) as PromiseLike<
          PostgrestPage<{ group_id: number | null }>
        >;
      },
      'Failed to fetch groups',
    );
    return new Set(
      rows
        .map((row) => row.group_id)
        .filter((id): id is number => typeof id === 'number'),
    );
  }

  /**
   * Groups in id order: all of them, those of some orgs, one creator's, or the
   * given ids (an empty `ids`/`orgIds` list matches nothing).
   */
  private async selectGroups(
    pool: GroupPool,
    filter: {
      orgId?: string;
      orgIds?: string[];
      createdBy?: string;
      ids?: number[];
    },
  ): Promise<GroupRow[]> {
    if (filter.ids?.length === 0 || filter.orgIds?.length === 0) {
      return [];
    }
    const { ids: allIds } = filter;
    const chunks = allIds
      ? Array.from({ length: Math.ceil(allIds.length / ID_CHUNK) }, (_, i) =>
          allIds.slice(i * ID_CHUNK, (i + 1) * ID_CHUNK),
        )
      : [undefined];

    const rows: GroupRow[] = [];
    for (const ids of chunks) {
      rows.push(
        ...(await selectAllPages<GroupRow>((from, to) => {
          let query = this.supabaseService
            .getClient()
            .from(pool.table)
            .select(GROUP_COLUMNS);
          if (filter.orgId !== undefined) {
            query = query.eq('org_id', filter.orgId);
          }
          if (filter.orgIds !== undefined) {
            query = query.in('org_id', filter.orgIds);
          }
          if (filter.createdBy !== undefined) {
            query = query.eq('created_by', filter.createdBy);
          }
          if (ids !== undefined) query = query.in('id', ids);
          return query
            .order('id', { ascending: true })
            .range(from, to) as PromiseLike<PostgrestPage<GroupRow>>;
        }, 'Failed to fetch groups')),
      );
    }
    return rows;
  }
}
