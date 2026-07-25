import { InternalServerErrorException } from '@nestjs/common';
import type { SupabaseService } from '../../supabase/supabase.service';
import type { TableRow } from '../types/supabase';
import { MANAGE_CEILING, PermissionLevel } from './permission-levels';

type DeviceRow = TableRow<'cw_devices'>;
type DeviceOwnerRow = TableRow<'cw_device_owners'>;

/** A device with the caller's effective permissions resolved. */
export interface ManagedDevice {
  devEui: string;
  name: string | null;
  permissionLevel: number | null;
  canView: boolean;
  canManage: boolean;
}

/**
 * Lists every device with the caller's effective view/manage permissions,
 * resolved from direct ownership and cw_device_owners entries. Staff can
 * view and manage everything.
 */
export async function listManagedDevices(
  client: ReturnType<SupabaseService['getClient']>,
  userId: string,
  isStaff: boolean,
): Promise<ManagedDevice[]> {
  const { data, error } = await client
    .from('cw_devices')
    .select('dev_eui, name, user_id, cw_device_owners(*)');

  if (error) {
    throw new InternalServerErrorException('Failed to load devices');
  }

  const rows = (data ?? []) as Array<
    Pick<DeviceRow, 'dev_eui' | 'name' | 'user_id'> & {
      cw_device_owners?: DeviceOwnerRow[] | null;
    }
  >;

  return rows
    .map((row): ManagedDevice => {
      const owners = Array.isArray(row.cw_device_owners)
        ? row.cw_device_owners
        : [];
      const ownEntry = owners.find((entry) => entry.user_id === userId);
      const directOwner = row.user_id === userId;
      const permissionLevel = directOwner
        ? PermissionLevel.ADMIN
        : (ownEntry?.permission_level ?? null);
      const canView =
        isStaff ||
        directOwner ||
        (permissionLevel != null && permissionLevel < PermissionLevel.DISABLED);
      const canManage =
        isStaff ||
        directOwner ||
        (permissionLevel != null && permissionLevel <= MANAGE_CEILING);

      return {
        devEui: row.dev_eui,
        name: row.name?.trim() ? row.name : null,
        permissionLevel,
        canView,
        canManage,
      };
    })
    .filter((device) => device.devEui.length > 0);
}
