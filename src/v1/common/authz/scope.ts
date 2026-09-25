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
 * A row is readable when ANY of these hold:
 *   - the caller is its implicit owner (user_id / owner_id),
 *   - the caller has an owner_match grant row below the ceiling,
 *   - the row's org_id is in the caller's org-readable set (their own org
 *     when they are owner/manager, plus child orgs via a parent link) —
 *     pass it from `AccessService.getOrgContext(user)`.
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

const UUID_SHAPE = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function orClauses(
  user: AuthenticatedUser,
  ownerColumn: 'user_id' | 'owner_id',
  orgIds: readonly string[],
): string {
  const clauses = [`${ownerColumn}.eq.${user.sub}`, 'owner_match.not.is.null'];
  // Org ids come from our own DB, but they are interpolated into a PostgREST
  // filter string — refuse anything that is not a plain UUID.
  const safeOrgIds = orgIds.filter((id) => UUID_SHAPE.test(id));
  if (safeOrgIds.length > 0) {
    clauses.push(`org_id.in.(${safeOrgIds.join(',')})`);
  }
  return clauses.join(',');
}

function applyScope<Q extends ScopedQuery<Q>>(
  query: Q,
  user: AuthenticatedUser,
  ownerColumn: 'user_id' | 'owner_id',
  orgIds: readonly string[],
  levelFilter: (query: Q) => Q,
): Q {
  if (user.isStaff) {
    return query;
  }

  return levelFilter(query.eq('owner_match.user_id', user.sub)).or(
    orClauses(user, ownerColumn, orgIds),
  );
}

/**
 * Rows the caller may read. `readableOrgIds` is
 * `OrgContext.managedOrgIds + OrgContext.parentReadOrgIds` — omit it only in
 * code paths that intentionally ignore org access (none today besides tests).
 */
export function applyDeviceReadScope<Q extends ScopedQuery<Q>>(
  query: Q,
  user: AuthenticatedUser,
  readableOrgIds: readonly string[] = [],
): Q {
  return applyScope(query, user, 'user_id', readableOrgIds, (q) =>
    q.lt('owner_match.permission_level', READ_EXCLUSIVE_CEILING),
  );
}

/**
 * Rows the caller may manage. `managedOrgIds` is `OrgContext.managedOrgIds`
 * only — parent-linked orgs are read-only and must NOT be passed here.
 */
export function applyDeviceManageScope<Q extends ScopedQuery<Q>>(
  query: Q,
  user: AuthenticatedUser,
  ceiling: number = MANAGE_CEILING,
  managedOrgIds: readonly string[] = [],
): Q {
  return applyScope(query, user, 'user_id', managedOrgIds, (q) =>
    q.lte('owner_match.permission_level', ceiling),
  );
}

export function applyLocationReadScope<Q extends ScopedQuery<Q>>(
  query: Q,
  user: AuthenticatedUser,
  readableOrgIds: readonly string[] = [],
): Q {
  return applyScope(query, user, 'owner_id', readableOrgIds, (q) =>
    q.lt('owner_match.permission_level', READ_EXCLUSIVE_CEILING),
  );
}

export function applyLocationManageScope<Q extends ScopedQuery<Q>>(
  query: Q,
  user: AuthenticatedUser,
  ceiling: number = MANAGE_CEILING,
  managedOrgIds: readonly string[] = [],
): Q {
  return applyScope(query, user, 'owner_id', managedOrgIds, (q) =>
    q.lte('owner_match.permission_level', ceiling),
  );
}
