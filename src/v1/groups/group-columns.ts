/**
 * The ONE place that knows how a device's or location's group is stored.
 *
 * Since 038 a group is a row in cw_location_groups / cw_device_groups and a
 * resource points at it through `group_id`. The API's interface did not
 * change: every response still carries the group's name as `group` (string
 * or null) and no `group_id`. Queries embed the group's name with the
 * constants below and responses go through `withLocationGroup` /
 * `withDeviceGroup`. `no-raw-group-column.spec.ts` fails the build if a query
 * outside this directory names the old text column.
 */

/** Embeds a location's group name (`location_group: { name } | null`). */
export const LOCATION_GROUP_EMBED = 'location_group:cw_location_groups(name)';
/** Same, but drops locations without a group; use when filtering by name. */
export const LOCATION_GROUP_INNER_EMBED =
  'location_group:cw_location_groups!inner(name)';
/** Filter column for the group name embedded by the two constants above. */
export const LOCATION_GROUP_NAME = 'location_group.name';

/** Embeds a device's group name (`device_group: { name } | null`). */
export const DEVICE_GROUP_EMBED = 'device_group:cw_device_groups(name)';
/** Same, but drops devices without a group; use when filtering by name. */
export const DEVICE_GROUP_INNER_EMBED =
  'device_group:cw_device_groups!inner(name)';
/** Filter column for the group name embedded by the two constants above. */
export const DEVICE_GROUP_NAME = 'device_group.name';

/**
 * Filter column for the location group of a device query that embeds
 * `deviceLocationEmbed(…, { groupFilter: true })`.
 */
export const DEVICE_LOCATION_GROUP_NAME = 'cw_locations.location_group.name';

/**
 * The `cw_locations(…)` embed of a device query, with the location's group
 * name. `inner` keeps only devices that have a location; `groupFilter` also
 * keeps only locations that have a group, which a filter on
 * DEVICE_LOCATION_GROUP_NAME needs to drop the other devices outright.
 */
export function deviceLocationEmbed(
  columns: string,
  options: { inner?: boolean; groupFilter?: boolean } = {},
): string {
  const inner = options.inner || options.groupFilter ? '!inner' : '';
  const group = options.groupFilter
    ? LOCATION_GROUP_INNER_EMBED
    : LOCATION_GROUP_EMBED;
  return `cw_locations${inner}(${columns}, ${group})`;
}

/** An embedded group as PostgREST returns it (an object, or a one-row list). */
export type GroupEmbed =
  | { name: string | null }
  | { name: string | null }[]
  | null
  | undefined;

/** The name of an embedded group, or null. */
export function groupName(embed: GroupEmbed): string | null {
  const group = Array.isArray(embed) ? embed[0] : embed;
  return group?.name ?? null;
}

type WithGroupColumns = { group_id?: number | null; group?: unknown };

/** A location row as the API returns it: `group` is the group's name. */
export type LocationWithGroup<T> = Omit<
  T,
  'location_group' | 'group_id' | 'group'
> & { group: string | null };

/** A device row as the API returns it: `group` is the group's name. */
export type DeviceWithGroup<T> = Omit<
  T,
  'device_group' | 'group_id' | 'group'
> & { group: string | null };

/**
 * A location row in the API's response shape: the embedded group becomes
 * `group` (its name), and `group_id` and the embed are left out.
 */
export function withLocationGroup<
  T extends WithGroupColumns & { location_group?: GroupEmbed },
>(row: T): LocationWithGroup<T> {
  const { location_group, group_id: _groupId, group: _text, ...rest } = row;
  return { ...rest, group: groupName(location_group) };
}

/**
 * A device row in the API's response shape: the embedded group becomes
 * `group` (its name), and `group_id` and the embed are left out.
 */
export function withDeviceGroup<
  T extends WithGroupColumns & { device_group?: GroupEmbed },
>(row: T): DeviceWithGroup<T> {
  const { device_group, group_id: _groupId, group: _text, ...rest } = row;
  return { ...rest, group: groupName(device_group) };
}
