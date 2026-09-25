/**
 * AccessService — the one place that resolves "what may this caller do to
 * this device / location", per request.
 *
 * Resolution happens in two shapes:
 *  - point lookups (`getDeviceAccess` / `getLocationAccess`) fetch the single
 *    resource with its owner rows and compute the caller's effective level in
 *    JS, returning an AccessSubject for `decide()`;
 *  - list queries go through the scope helpers in `scope.ts`
 *    (`listAccessibleDevices` replaces the old full-table
 *    `listManagedDevices` scan with a query scoped to the caller).
 *
 * Point lookups are memoized per request, keyed on the `request.user` object
 * Passport creates for each request, so several guards/services asking about
 * the same resource cost one query.
 */
import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import type { PostgrestError } from '@supabase/supabase-js';
import { SupabaseService } from '../../../supabase/supabase.service';
import type { AuthenticatedUser } from '../../auth/authenticated-user';
import type { TableRow } from '../../types/supabase';
import { PermissionLevel, canRead } from '../permission-levels';
import { Action } from './actions';
import { type AccessSubject, decide } from './policy';

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
  cw_device_owners: OwnerEntry[] | null;
};

type LocationAccessRow = {
  location_id: number;
  owner_id: string | null;
  cw_location_owners: LocationOwnerEntry[] | null;
};

type AccessibleDeviceRow = {
  dev_eui: string;
  name: string | null;
  user_id: string | null;
  owner_match?: OwnerEntry[] | null;
};

/** The caller's resolved relationship to one device. */
export interface DeviceAccess extends AccessSubject {
  exists: boolean;
  devEui: string;
  locationId: number | null;
  /** Implicit owner's user id (cw_devices.user_id). */
  ownerId: string | null;
  canRead: boolean;
}

/** The caller's resolved relationship to one location. */
export interface LocationAccess extends AccessSubject {
  exists: boolean;
  locationId: number;
  /** Implicit owner's user id (cw_locations.owner_id). */
  ownerId: string | null;
  canRead: boolean;
}

/** A device with the caller's effective permissions resolved. */
export interface AccessibleDevice {
  devEui: string;
  name: string | null;
  permissionLevel: number | null;
  canView: boolean;
  canManage: boolean;
}

@Injectable()
export class AccessService {
  /**
   * Per-request memo of point lookups, keyed on the AuthenticatedUser object
   * (a fresh instance per request). Values are promises so concurrent asks
   * share one query.
   */
  private readonly requestCache = new WeakMap<
    AuthenticatedUser,
    Map<string, Promise<unknown>>
  >();

  constructor(private readonly supabaseService: SupabaseService) {}

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

  /**
   * Resolves the caller's effective access to one device from the device's
   * own permission rows only (cw_devices.user_id + cw_device_owners).
   * Location grants intentionally do NOT bleed into device access — a
   * Disabled device row hides the device regardless of location level.
   */
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
          'dev_eui, user_id, location_id, cw_device_owners(user_id, permission_level)',
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
          ownerId: null,
          isStaff: user.isStaff,
          isOwner: false,
          level: null,
          canRead: user.isStaff,
        } satisfies DeviceAccess;
      }

      const row = data;
      const isOwner = row.user_id === user.sub;
      const ownEntry = (row.cw_device_owners ?? []).find(
        (entry) => entry.user_id === user.sub,
      );
      const level = isOwner
        ? PermissionLevel.ADMIN
        : (ownEntry?.permission_level ?? null);

      return {
        exists: true,
        devEui: row.dev_eui,
        locationId: row.location_id,
        ownerId: row.user_id,
        isStaff: user.isStaff,
        isOwner,
        level,
        canRead: user.isStaff || isOwner || canRead(level),
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
          'location_id, owner_id, cw_location_owners(user_id, permission_level)',
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
          ownerId: null,
          isStaff: user.isStaff,
          isOwner: false,
          level: null,
          canRead: user.isStaff,
        } satisfies LocationAccess;
      }

      const row = data;
      const isOwner = row.owner_id === user.sub;
      const ownEntry = (row.cw_location_owners ?? []).find(
        (entry) => entry.user_id === user.sub,
      );
      const level = isOwner
        ? PermissionLevel.ADMIN
        : (ownEntry?.permission_level ?? null);

      return {
        exists: true,
        locationId: row.location_id,
        ownerId: row.owner_id,
        isStaff: user.isStaff,
        isOwner,
        level,
        canRead: user.isStaff || isOwner || canRead(level),
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

  /**
   * Every device the caller has a relationship with (direct ownership or a
   * cw_device_owners row, including Disabled), with effective view/manage
   * flags. Staff see every device.
   *
   * Replaces the old `listManagedDevices` helper, which scanned the entire
   * cw_devices table with all owner rows on every call. The scoped query
   * returns only the caller's rows, so devices the caller has no
   * relationship to are no longer fetched (they were always invisible).
   */
  listAccessibleDevices(user: AuthenticatedUser): Promise<AccessibleDevice[]> {
    return this.memo(user, 'devices:accessible', async () => {
      const client = this.supabaseService.getClient();

      let query = client
        .from('cw_devices')
        .select(
          'dev_eui, name, user_id, owner_match:cw_device_owners(user_id, permission_level)',
        );

      if (!user.isStaff) {
        // Any relationship at all (owner or any owner row, incl. Disabled):
        // canView/canManage below decide what it is worth. This mirrors the
        // old helper, which returned Disabled rows with canView=false.
        query = query
          .eq('owner_match.user_id', user.sub)
          .or(`user_id.eq.${user.sub},owner_match.not.is.null`);
      }

      const { data, error } = (await query) as QueryResult<
        AccessibleDeviceRow[]
      >;

      if (error) {
        throw new InternalServerErrorException('Failed to load devices');
      }

      const rows = data ?? [];

      return rows
        .map((row): AccessibleDevice => {
          const owners = Array.isArray(row.owner_match) ? row.owner_match : [];
          const ownEntry = owners.find((entry) => entry.user_id === user.sub);
          const directOwner = row.user_id === user.sub;
          const permissionLevel = directOwner
            ? PermissionLevel.ADMIN
            : (ownEntry?.permission_level ?? null);
          const subject: AccessSubject = {
            isStaff: user.isStaff,
            isOwner: directOwner,
            level: permissionLevel,
          };

          return {
            devEui: row.dev_eui,
            name: row.name?.trim() ? row.name : null,
            permissionLevel,
            canView: user.isStaff || directOwner || canRead(permissionLevel),
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
