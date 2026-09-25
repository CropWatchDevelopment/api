/**
 * The ONE implementation of PostgREST query scoping for devices and
 * locations.
 *
 * Every list/permission query in the API runs against the service-role
 * client (RLS is bypassed by design — see supabase.service.ts), so these
 * filters ARE the authorization boundary. They must never be re-implemented
 * inline in a service; `no-raw-scope-filters.spec.ts` fails the build if the
 * scope idiom appears outside this directory.
 *
 * Usage: the caller's select string must embed the owner rows under the
 * `owner_match` alias, e.g.
 *   .select(`*, ${DEVICE_OWNER_MATCH_EMBED}`)     // devices
 *   .select(`*, ${LOCATION_OWNER_MATCH_EMBED}`)   // locations
 * and then pass the query through one of the scope helpers below.
 */
import { MANAGE_CEILING, READ_EXCLUSIVE_CEILING } from '../permission-levels';
import type { AuthenticatedUser } from '../../auth/authenticated-user';

/** Empty embed used purely for scope filtering (returns no columns). */
export const DEVICE_OWNER_MATCH_EMBED = 'owner_match:cw_device_owners()';
export const LOCATION_OWNER_MATCH_EMBED = 'owner_match:cw_location_owners()';

/**
 * Structural constraint for the Supabase query builders the scope helpers
 * accept: the helpers only chain `.eq`, `.lt`/`.lte`, and `.or`.
 */
export interface ScopedQuery<Q> {
  eq(column: string, value: unknown): Q;
  lt(column: string, value: unknown): Q;
  lte(column: string, value: unknown): Q;
  or(filters: string): Q;
}

/**
 * Rows the caller may read: direct owner, or an owner_match row strictly
 * below DISABLED. Staff see everything.
 *
 * `ownerColumn` is the implicit-owner column on the scoped table:
 * `user_id` for cw_devices, `owner_id` for cw_locations.
 */
function applyScope<Q extends ScopedQuery<Q>>(
  query: Q,
  user: AuthenticatedUser,
  ownerColumn: 'user_id' | 'owner_id',
  levelFilter: (query: Q) => Q,
): Q {
  if (user.isStaff) {
    return query;
  }

  return levelFilter(query.eq('owner_match.user_id', user.sub)).or(
    `${ownerColumn}.eq.${user.sub},owner_match.not.is.null`,
  );
}

export function applyDeviceReadScope<Q extends ScopedQuery<Q>>(
  query: Q,
  user: AuthenticatedUser,
): Q {
  return applyScope(query, user, 'user_id', (q) =>
    q.lt('owner_match.permission_level', READ_EXCLUSIVE_CEILING),
  );
}

export function applyDeviceManageScope<Q extends ScopedQuery<Q>>(
  query: Q,
  user: AuthenticatedUser,
  ceiling: number = MANAGE_CEILING,
): Q {
  return applyScope(query, user, 'user_id', (q) =>
    q.lte('owner_match.permission_level', ceiling),
  );
}

export function applyLocationReadScope<Q extends ScopedQuery<Q>>(
  query: Q,
  user: AuthenticatedUser,
): Q {
  return applyScope(query, user, 'owner_id', (q) =>
    q.lt('owner_match.permission_level', READ_EXCLUSIVE_CEILING),
  );
}

export function applyLocationManageScope<Q extends ScopedQuery<Q>>(
  query: Q,
  user: AuthenticatedUser,
  ceiling: number = MANAGE_CEILING,
): Q {
  return applyScope(query, user, 'owner_id', (q) =>
    q.lte('owner_match.permission_level', ceiling),
  );
}
