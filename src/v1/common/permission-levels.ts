/**
 * Single source of truth for the CropWatch permission model.
 *
 * Owner is implicit (cw_locations.owner_id / cw_devices.user_id) and outranks
 * every level. Levels are stored in cw_device_owners.permission_level and
 * cw_location_owners.permission_level (numeric).
 *
 * Mirrored in the web app at CropWatch/src/lib/constants/permissions.ts —
 * keep the two files in sync. Full spec: docs/permission-model.md.
 */
export const PermissionLevel = {
    ADMIN: 1,
    MANAGER: 2,
    USER: 3,
    VIEWER: 4,
    DISABLED: 5,
} as const;

export type PermissionLevel = (typeof PermissionLevel)[keyof typeof PermissionLevel];

export const MIN_PERMISSION_LEVEL: PermissionLevel = PermissionLevel.ADMIN;
export const MAX_PERMISSION_LEVEL: PermissionLevel = PermissionLevel.DISABLED;

/**
 * Read scope: any level strictly below DISABLED can see the resource.
 * Use with exclusive comparisons, e.g. `.lt('permission_level', READ_EXCLUSIVE_CEILING)`.
 */
export const READ_EXCLUSIVE_CEILING: PermissionLevel = PermissionLevel.DISABLED;

/**
 * Manage scope: ADMIN and MANAGER may manage users, rules, and reports.
 * Use with inclusive comparisons, e.g. `.lte('permission_level', MANAGE_CEILING)`.
 */
export const MANAGE_CEILING: PermissionLevel = PermissionLevel.MANAGER;

export function canRead(level: number | null | undefined): boolean {
    return level != null && level < PermissionLevel.DISABLED;
}

export function canManage(level: number | null | undefined): boolean {
    return level != null && level <= PermissionLevel.MANAGER;
}

export function isValidPermissionLevel(level: number): boolean {
    return (
        Number.isInteger(level) &&
        level >= MIN_PERMISSION_LEVEL &&
        level <= MAX_PERMISSION_LEVEL
    );
}
