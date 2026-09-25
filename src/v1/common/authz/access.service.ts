/**
 * AccessService — the one place that resolves "what may this caller do to
 * this resource", per request.
 *
 * Resolution (plan section 4.6, in order): staff → suspended contributes
 * nothing → owner/manager of the resource's org → owner/manager of the
 * parent org (read+download) → member/guest grants (device override,
 * else the location default; guests capped at Viewer) → no access (404).
 *
 * Grants also stand alone for pre-organization cross-account shares (a
 * grant row without any membership in the resource's org keeps working,
 * grandfathered until staff convert those accounts).
 *
 * Point lookups and the org context are memoized per request, keyed on the
 * `request.user` object Passport creates for each request.
 */
import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import type { PostgrestError } from '@supabase/supabase-js';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../../../supabase/supabase.service';
import type { AuthenticatedUser } from '../../auth/authenticated-user';
import type { TableRow } from '../../types/supabase';
import { PermissionLevel, canRead } from '../permission-levels';
import { Action } from './actions';
import { type AccessSubject, decide } from './policy';
import {
  type GuestSeat,
  type OrgContext,
  emptyOrgContext,
  orgRoleFor,
  parentReadFor,
} from './org-context';

type DeviceOwnerRow = TableRow<'cw_device_owners'>;
type LocationOwnerRow = TableRow<'cw_location_owners'>;
type OwnerEntry = Pick<DeviceOwnerRow, 'user_id' | 'permission_level'>;
type LocationOwnerEntry = Pick<
  LocationOwnerRow,
  'user_id' | 'permission_level'
>;
type QueryResult<T> = { data: T | null; error: PostgrestError | null };

type DeviceAccessRow = {
  dev_eui: string;
  user_id: string | null;
  location_id: number | null;
  org_id: string | null;
  cw_device_owners: OwnerEntry[] | null;
};

type LocationAccessRow = {
  location_id: number;
  owner_id: string | null;
  org_id: string | null;
  cw_location_owners: LocationOwnerEntry[] | null;
};

type AccessibleDeviceRow = {
  dev_eui: string;
  name: string | null;
  user_id: string | null;
  location_id: number | null;
  org_id: string | null;
  owner_match?: OwnerEntry[] | null;
};

type MembershipRow = {
  org_id: string;
  role: 'owner' | 'manager' | 'member' | 'guest';
  status: 'active' | 'suspended';
  expires_at: string | null;
  organizations: {
    id: string;
    type: 'personal' | 'company';
    name: string;
    deactivated_at: string | null;
  } | null;
};

/** The caller's active-and-usable location grants, keyed by location id. */
type LocationGrantMap = Map<number, number>;

/** The caller's resolved relationship to one device. */
export interface DeviceAccess extends AccessSubject {
  exists: boolean;
  devEui: string;
  locationId: number | null;
  /** The device's owning organization. */
  orgId: string | null;
  /** Implicit owner's user id (cw_devices.user_id). */
  ownerId: string | null;
  canRead: boolean;
}

/** The caller's resolved relationship to one location. */
export interface LocationAccess extends AccessSubject {
  exists: boolean;
  locationId: number;
  /** The location's owning organization. */
  orgId: string | null;
  /** Implicit owner's user id (cw_locations.owner_id). */
  ownerId: string | null;
  canRead: boolean;
}

/** A device with the caller's effective permissions resolved. */
export interface AccessibleDevice {
  devEui: string;
  name: string | null;
  orgId: string | null;
  permissionLevel: number | null;
  canView: boolean;
  canManage: boolean;
}

const UUID_SHAPE = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

@Injectable()
export class AccessService {
  /**
   * Per-request memo, keyed on the AuthenticatedUser object (a fresh
   * instance per request). Values are promises so concurrent asks share one
   * query.
   */
  private readonly requestCache = new WeakMap<
    AuthenticatedUser,
    Map<string, Promise<unknown>>
  >();

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
  ) {}

  private memo<T>(
    user: AuthenticatedUser,
    key: string,
    load: () => Promise<T>,
  ): Promise<T> {
    let cache = this.requestCache.get(user);
    if (!cache) {
      cache = new Map();
      this.requestCache.set(user, cache);
    }
    let entry = cache.get(key) as Promise<T> | undefined;
    if (!entry) {
      entry = load();
      // Do not cache failures — a transient DB error must not poison the request.
      entry.catch(() => cache.delete(key));
      cache.set(key, entry);
    }
    return entry;
  }

  // -------------------------------------------------------------------------
  // Org context
  // -------------------------------------------------------------------------

  /** The caller's organizational standing (memoized per request). */
  getOrgContext(user: AuthenticatedUser): Promise<OrgContext> {
    return this.memo(user, 'org:context', async () => {
      // Kill-switch: ORG_OVERLAY_DISABLED=true collapses resolution to
      // grants-only (exact pre-organizations behavior) without a deploy.
      // Flip the env var back off to restore the org overlay.
      if (this.configService.get<string>('ORG_OVERLAY_DISABLED') === 'true') {
        return emptyOrgContext(user.isStaff);
      }
      const client = this.supabaseService.getClient();
      const { data, error } = (await client
        .from('organization_members')
        .select(
          'org_id, role, status, expires_at, organizations!inner(id, type, name, deactivated_at)',
        )
        .eq('user_id', user.sub)) as QueryResult<MembershipRow[]>;

      if (error) {
        throw new InternalServerErrorException(
          'Failed to load organization membership',
        );
      }

      const ctx = emptyOrgContext(user.isStaff);
      const now = Date.now();

      for (const row of data ?? []) {
        const org = row.organizations;
        if (!org || org.deactivated_at != null) {
          continue; // parked personal orgs grant nothing
        }
        if (row.status === 'suspended') {
          ctx.dormantOrgIds.push(org.id);
          if (row.role !== 'guest') {
            ctx.suspended = true;
          }
          continue;
        }
        if (row.role === 'guest') {
          if (row.expires_at != null && Date.parse(row.expires_at) <= now) {
            ctx.dormantOrgIds.push(org.id);
            continue;
          }
          ctx.guestOrgIds.push(org.id);
          ctx.guestSeats.push({
            orgId: org.id,
            orgName: org.name,
            expiresAt: row.expires_at,
          } satisfies GuestSeat);
          continue;
        }
        // The single active full membership (DB-enforced: at most one).
        ctx.org = {
          id: org.id,
          type: org.type,
          name: org.name,
          role: row.role,
        };
        if (row.role === 'owner' || row.role === 'manager') {
          ctx.managedOrgIds.push(org.id);
        }
      }

      // Parent link: owner/manager of a parent org reads its children.
      if (ctx.managedOrgIds.length > 0) {
        const { data: children, error: childError } = (await client
          .from('organizations')
          .select('id')
          .eq('parent_org_id', ctx.managedOrgIds[0])
          .is('deactivated_at', null)) as QueryResult<{ id: string }[]>;
        if (childError) {
          throw new InternalServerErrorException(
            'Failed to load child organizations',
          );
        }
        ctx.parentReadOrgIds = (children ?? []).map((c) => c.id);
      }

      return ctx;
    });
  }

  /**
   * Org ids whose resources the caller can READ org-wide (their managed org
   * plus parent-linked children) — feed this to the read-scope helpers.
   */
  async getReadableOrgIds(user: AuthenticatedUser): Promise<string[]> {
    const ctx = await this.getOrgContext(user);
    return [...ctx.managedOrgIds, ...ctx.parentReadOrgIds];
  }

  /** Org ids the caller can MANAGE org-wide — feed to manage-scope helpers. */
  async getManagedOrgIds(user: AuthenticatedUser): Promise<string[]> {
    const ctx = await this.getOrgContext(user);
    return ctx.managedOrgIds;
  }

  /**
   * Asserts the caller may perform an org-level action (no concrete
   * resource) on the given org: 404 when they have no standing there at
   * all, 403 when they have standing but not the role the action needs.
   */
  async assertOrgAction(
    user: AuthenticatedUser,
    orgId: string,
    action: Action,
  ): Promise<OrgContext> {
    const ctx = await this.getOrgContext(user);
    if (ctx.isStaff) {
      return ctx;
    }
    const isMember = ctx.org?.id === orgId;
    const isGuest = ctx.guestOrgIds.includes(orgId);
    if (!isMember && !isGuest) {
      throw new NotFoundException('Organization not found');
    }
    const subject: AccessSubject = {
      isStaff: false,
      isOwner: false,
      level: null,
      orgRole: orgRoleFor(ctx, orgId),
      parentRead: false,
    };
    const allowed =
      decide(subject, action) ||
      // Members and guests may read their own org's basics.
      (action === Action.OrgRead && (isMember || isGuest));
    if (!allowed) {
      throw new ForbiddenException(
        'You do not have permission to perform this action in this organization',
      );
    }
    return ctx;
  }

  // -------------------------------------------------------------------------
  // Grants
  // -------------------------------------------------------------------------

  /**
   * The caller's raw active location grants (location_id → default device
   * level). Level 5 rows are revoked grants and excluded.
   */
  private getLocationGrants(
    user: AuthenticatedUser,
  ): Promise<LocationGrantMap> {
    return this.memo(user, 'grants:locations', async () => {
      const client = this.supabaseService.getClient();
      const { data, error } = (await client
        .from('cw_location_owners')
        .select('location_id, permission_level')
        .eq('user_id', user.sub)
        .eq('is_active', true)) as QueryResult<
        { location_id: number; permission_level: number | null }[]
      >;
      if (error) {
        throw new InternalServerErrorException(
          'Failed to load location grants',
        );
      }
      const map: LocationGrantMap = new Map();
      for (const row of data ?? []) {
        const level = row.permission_level;
        if (level != null && level < PermissionLevel.DISABLED) {
          const existing = map.get(row.location_id);
          if (existing === undefined || level < existing) {
            map.set(row.location_id, level);
          }
        }
      }
      return map;
    });
  }

  /**
   * Effective grant level on a device inside `orgId`: the device override
   * when a row exists, else the caller's location default. Applies the
   * suspension/expiry dormancy and the guest Viewer cap.
   */
  private effectiveLevel(
    ctx: OrgContext,
    orgId: string | null,
    overrideLevel: number | null | undefined,
    locationDefault: number | null | undefined,
  ): number | null {
    if (orgId != null && ctx.dormantOrgIds.includes(orgId)) {
      return null; // suspended member / expired guest: grants are dormant
    }
    let level =
      overrideLevel != null ? overrideLevel : (locationDefault ?? null);
    if (level == null) {
      return null;
    }
    if (orgId != null && ctx.guestOrgIds.includes(orgId)) {
      level = Math.max(level, PermissionLevel.VIEWER); // guests capped at Viewer
    }
    return level;
  }

  // -------------------------------------------------------------------------
  // Point lookups
  // -------------------------------------------------------------------------

  /** Resolves the caller's effective access to one device. */
  getDeviceAccess(
    user: AuthenticatedUser,
    devEui: string,
  ): Promise<DeviceAccess> {
    const normalized = devEui?.trim() ?? '';
    return this.memo(user, `device:${normalized}`, async () => {
      const client = this.supabaseService.getClient();
      const { data, error } = (await client
        .from('cw_devices')
        .select(
          'dev_eui, user_id, location_id, org_id, cw_device_owners(user_id, permission_level)',
        )
        .eq('dev_eui', normalized)
        .maybeSingle()) as QueryResult<DeviceAccessRow>;

      if (error) {
        throw new InternalServerErrorException('Failed to fetch device');
      }

      if (!data) {
        return {
          exists: false,
          devEui: normalized,
          locationId: null,
          orgId: null,
          ownerId: null,
          isStaff: user.isStaff,
          isOwner: false,
          level: null,
          orgRole: null,
          parentRead: false,
          canRead: user.isStaff,
        } satisfies DeviceAccess;
      }

      const ctx = await this.getOrgContext(user);
      const row = data;
      const isOwner = row.user_id === user.sub;
      const ownEntry = (row.cw_device_owners ?? []).find(
        (entry) => entry.user_id === user.sub,
      );
      const overrideLevel = isOwner
        ? PermissionLevel.ADMIN
        : (ownEntry?.permission_level ?? null);
      const locationDefault =
        !isOwner && overrideLevel == null && row.location_id != null
          ? (await this.getLocationGrants(user)).get(row.location_id)
          : undefined;
      const level = this.effectiveLevel(
        ctx,
        row.org_id,
        overrideLevel,
        locationDefault,
      );
      const orgRole = orgRoleFor(ctx, row.org_id);
      const parentRead = parentReadFor(ctx, row.org_id);

      return {
        exists: true,
        devEui: row.dev_eui,
        locationId: row.location_id,
        orgId: row.org_id,
        ownerId: row.user_id,
        isStaff: user.isStaff,
        isOwner,
        level,
        orgRole,
        parentRead,
        canRead:
          user.isStaff ||
          isOwner ||
          orgRole != null ||
          parentRead ||
          canRead(level),
      } satisfies DeviceAccess;
    });
  }

  /** Resolves the caller's effective access to one location. */
  getLocationAccess(
    user: AuthenticatedUser,
    locationId: number,
  ): Promise<LocationAccess> {
    return this.memo(user, `location:${locationId}`, async () => {
      const client = this.supabaseService.getClient();
      const { data, error } = (await client
        .from('cw_locations')
        .select(
          'location_id, owner_id, org_id, cw_location_owners(user_id, permission_level)',
        )
        .eq('location_id', locationId)
        .maybeSingle()) as QueryResult<LocationAccessRow>;

      if (error) {
        throw new InternalServerErrorException('Failed to fetch location');
      }

      if (!data) {
        return {
          exists: false,
          locationId,
          orgId: null,
          ownerId: null,
          isStaff: user.isStaff,
          isOwner: false,
          level: null,
          orgRole: null,
          parentRead: false,
          canRead: user.isStaff,
        } satisfies LocationAccess;
      }

      const ctx = await this.getOrgContext(user);
      const row = data;
      const isOwner = row.owner_id === user.sub;
      const ownEntry = (row.cw_location_owners ?? []).find(
        (entry) => entry.user_id === user.sub,
      );
      const grantLevel = isOwner
        ? PermissionLevel.ADMIN
        : (ownEntry?.permission_level ?? null);
      const level = this.effectiveLevel(ctx, row.org_id, grantLevel, null);
      const orgRole = orgRoleFor(ctx, row.org_id);
      const parentRead = parentReadFor(ctx, row.org_id);

      return {
        exists: true,
        locationId: row.location_id,
        orgId: row.org_id,
        ownerId: row.owner_id,
        isStaff: user.isStaff,
        isOwner,
        level,
        orgRole,
        parentRead,
        canRead:
          user.isStaff ||
          isOwner ||
          orgRole != null ||
          parentRead ||
          canRead(level),
      } satisfies LocationAccess;
    });
  }

  /**
   * Asserts the caller may perform `action` on the device.
   * 404 when the device does not exist or is invisible to the caller (never
   * reveals existence); 403 when visible but the action is above their level.
   */
  async assertDeviceAccess(
    user: AuthenticatedUser,
    devEui: string,
    action: Action,
  ): Promise<DeviceAccess> {
    const access = await this.getDeviceAccess(user, devEui);
    if (!access.exists || !access.canRead) {
      throw new NotFoundException('Device not found');
    }
    if (!decide(access, action)) {
      throw new ForbiddenException(
        'You do not have permission to perform this action on this device',
      );
    }
    return access;
  }

  /**
   * Asserts the caller may perform `action` on the location.
   * 404 when it does not exist or is invisible; 403 when visible but denied.
   */
  async assertLocationAccess(
    user: AuthenticatedUser,
    locationId: number,
    action: Action,
  ): Promise<LocationAccess> {
    const access = await this.getLocationAccess(user, locationId);
    if (!access.exists || !access.canRead) {
      throw new NotFoundException('Location not found');
    }
    if (!decide(access, action)) {
      throw new ForbiddenException(
        'You do not have permission to perform this action on this location',
      );
    }
    return access;
  }

  // -------------------------------------------------------------------------
  // Lists
  // -------------------------------------------------------------------------

  /**
   * Every device the caller can see or manage: direct ownership, a
   * cw_device_owners row (including Disabled), a location grant, or
   * org-wide access (own org as owner/manager, or a parent link). Staff see
   * every device.
   */
  listAccessibleDevices(user: AuthenticatedUser): Promise<AccessibleDevice[]> {
    return this.memo(user, 'devices:accessible', async () => {
      const client = this.supabaseService.getClient();
      const ctx = await this.getOrgContext(user);
      const grants = user.isStaff
        ? new Map<number, number>()
        : await this.getLocationGrants(user);

      let query = client
        .from('cw_devices')
        .select(
          'dev_eui, name, user_id, location_id, org_id, owner_match:cw_device_owners(user_id, permission_level)',
        );

      if (!user.isStaff) {
        const readableOrgIds = [
          ...ctx.managedOrgIds,
          ...ctx.parentReadOrgIds,
        ].filter((id) => UUID_SHAPE.test(id));
        const clauses = [`user_id.eq.${user.sub}`, 'owner_match.not.is.null'];
        if (readableOrgIds.length > 0) {
          clauses.push(`org_id.in.(${readableOrgIds.join(',')})`);
        }
        const grantLocationIds = [...grants.keys()].filter((id) =>
          Number.isInteger(id),
        );
        if (grantLocationIds.length > 0) {
          clauses.push(`location_id.in.(${grantLocationIds.join(',')})`);
        }
        query = query.eq('owner_match.user_id', user.sub).or(clauses.join(','));
      }

      const { data, error } = (await query) as QueryResult<
        AccessibleDeviceRow[]
      >;

      if (error) {
        throw new InternalServerErrorException('Failed to load devices');
      }

      return (data ?? [])
        .map((row): AccessibleDevice => {
          const owners = Array.isArray(row.owner_match) ? row.owner_match : [];
          const ownEntry = owners.find((entry) => entry.user_id === user.sub);
          const directOwner = row.user_id === user.sub;
          const overrideLevel = directOwner
            ? PermissionLevel.ADMIN
            : (ownEntry?.permission_level ?? null);
          const locationDefault =
            !directOwner && overrideLevel == null && row.location_id != null
              ? grants.get(row.location_id)
              : undefined;
          const level = this.effectiveLevel(
            ctx,
            row.org_id,
            overrideLevel,
            locationDefault,
          );
          const subject: AccessSubject = {
            isStaff: user.isStaff,
            isOwner: directOwner,
            level,
            orgRole: orgRoleFor(ctx, row.org_id),
            parentRead: parentReadFor(ctx, row.org_id),
          };

          return {
            devEui: row.dev_eui,
            name: row.name?.trim() ? row.name : null,
            orgId: row.org_id,
            permissionLevel: level,
            canView: decide(subject, Action.DeviceRead),
            canManage: decide(subject, Action.DeviceEdit),
          };
        })
        .filter((device) => device.devEui.length > 0);
    });
  }

  /**
   * Asserts the caller can manage every requested device. Shared by rules
   * and reports (previously duplicated in both services).
   */
  async assertDevicesManageable(
    user: AuthenticatedUser,
    devEuis: string[],
  ): Promise<void> {
    if (devEuis.length === 0) {
      return;
    }
    const devices = await this.listAccessibleDevices(user);
    const manageable = new Set(
      devices.filter((d) => d.canManage).map((d) => d.devEui),
    );
    const denied = devEuis.filter((devEui) => !manageable.has(devEui));
    if (denied.length > 0) {
      throw new ForbiddenException(
        'You do not have permission to manage one or more selected devices',
      );
    }
  }
}
