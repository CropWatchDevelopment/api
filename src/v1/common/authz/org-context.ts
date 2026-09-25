/**
 * The caller's organizational standing, resolved once per request.
 *
 * Single-org model: a person holds full membership (owner/manager/member)
 * in at most ONE active organization; every other relationship is a guest
 * seat. Suspended memberships and expired guest seats contribute nothing
 * (resolution order, plan section 4.6).
 */

/** The caller's one active full membership, if any. */
export interface OrgStanding {
  id: string;
  type: 'personal' | 'company';
  name: string;
  role: 'owner' | 'manager' | 'member';
}

export interface GuestSeat {
  orgId: string;
  orgName: string;
  expiresAt: string | null;
}

export interface OrgContext {
  isStaff: boolean;
  /** Active, unsuspended full membership (owner/manager/member) or null. */
  org: OrgStanding | null;
  /** True when a full membership exists but is suspended (it grants nothing). */
  suspended: boolean;
  /** Active, unexpired guest seats (view-only; access comes from grants). */
  guestSeats: GuestSeat[];
  /** Org ids of the active guest seats (grants there are capped at Viewer). */
  guestOrgIds: string[];
  /**
   * Orgs where the caller HAS a membership row that currently grants
   * nothing: suspended (any role) or an expired guest seat. Their grants on
   * those orgs' resources are dormant, not deleted.
   */
  dormantOrgIds: string[];
  /**
   * Org ids where the caller has automatic org-wide access:
   * their own org when they are its owner or manager.
   */
  managedOrgIds: string[];
  /**
   * Child-org ids the caller can view+download through a parent link
   * (only when they are owner/manager of the parent).
   */
  parentReadOrgIds: string[];
}

/** Context of a caller with no memberships at all (grants may still apply). */
export function emptyOrgContext(isStaff: boolean): OrgContext {
  return {
    isStaff,
    org: null,
    suspended: false,
    guestSeats: [],
    guestOrgIds: [],
    dormantOrgIds: [],
    managedOrgIds: [],
    parentReadOrgIds: [],
  };
}

/** Org role on a specific resource's org, derived from the context. */
export function orgRoleFor(
  ctx: OrgContext,
  resourceOrgId: string | null,
): 'owner' | 'manager' | null {
  if (!resourceOrgId || !ctx.org || ctx.org.id !== resourceOrgId) {
    return null;
  }
  return ctx.org.role === 'owner' || ctx.org.role === 'manager'
    ? ctx.org.role
    : null;
}

/** Whether the resource's org is readable through a parent link. */
export function parentReadFor(
  ctx: OrgContext,
  resourceOrgId: string | null,
): boolean {
  return resourceOrgId != null && ctx.parentReadOrgIds.includes(resourceOrgId);
}
