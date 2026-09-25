/**
 * Invitation and role-change rules (plan section 4.3), pure and
 * unit-testable. Staff bypass is handled by the callers.
 *
 *  - The Owner can invite anyone (Manager, Member, Guest) and change,
 *    suspend, or remove anyone except themselves.
 *  - Managers can invite Members and Managers, and edit/suspend/remove
 *    MEMBERS only — never other Managers, Guests, or the Owner.
 *  - Only the Owner touches Guests.
 *  - Nobody changes their own role; anyone except the Owner may leave.
 */
import { ForbiddenException } from '@nestjs/common';

export type OrgRole = 'owner' | 'manager' | 'member' | 'guest';

/** Roles the actor may invite into the org. */
export function inviteableRoles(actorRole: OrgRole | null): OrgRole[] {
  if (actorRole === 'owner') return ['manager', 'member', 'guest'];
  if (actorRole === 'manager') return ['manager', 'member'];
  return [];
}

export function assertCanInvite(
  actorRole: OrgRole | null,
  inviteRole: OrgRole,
): void {
  if (!inviteableRoles(actorRole).includes(inviteRole)) {
    throw new ForbiddenException(
      inviteRole === 'guest'
        ? 'Only the organization owner can invite guests'
        : 'You do not have permission to send this invite',
    );
  }
}

/** Change a member's role (manager <-> member) or their grants. */
export function assertCanEditMember(
  actorRole: OrgRole | null,
  targetRole: OrgRole,
  isSelf: boolean,
  newRole?: OrgRole,
): void {
  if (isSelf) {
    throw new ForbiddenException('You cannot change your own membership');
  }
  if (targetRole === 'owner') {
    throw new ForbiddenException(
      "The owner's membership cannot be changed — transfer ownership first",
    );
  }
  if (newRole === 'owner' || newRole === 'guest') {
    throw new ForbiddenException('Membership cannot be changed to this role');
  }
  if (actorRole === 'owner') {
    return;
  }
  if (actorRole === 'manager') {
    // Managers manage Members only, and cannot promote them to Manager.
    if (targetRole !== 'member') {
      throw new ForbiddenException(
        'Only the organization owner can change managers or guests',
      );
    }
    if (newRole !== undefined && newRole !== 'member') {
      throw new ForbiddenException(
        'Only the organization owner can promote members',
      );
    }
    return;
  }
  throw new ForbiddenException(
    'You do not have permission to manage members of this organization',
  );
}

export function assertCanSuspend(
  actorRole: OrgRole | null,
  targetRole: OrgRole,
  isSelf: boolean,
): void {
  if (isSelf) {
    throw new ForbiddenException('You cannot suspend yourself');
  }
  if (targetRole === 'owner') {
    throw new ForbiddenException('The owner cannot be suspended');
  }
  if (actorRole === 'owner') {
    return;
  }
  if (actorRole === 'manager' && targetRole === 'member') {
    return;
  }
  throw new ForbiddenException(
    'You do not have permission to suspend this member',
  );
}

export function assertCanRemove(
  actorRole: OrgRole | null,
  targetRole: OrgRole,
  isSelf: boolean,
): void {
  if (targetRole === 'owner') {
    throw new ForbiddenException(
      'The owner cannot leave — transfer ownership first',
    );
  }
  if (isSelf) {
    return; // anyone except the owner may leave
  }
  if (actorRole === 'owner') {
    return;
  }
  if (actorRole === 'manager' && targetRole === 'member') {
    return;
  }
  throw new ForbiddenException(
    'You do not have permission to remove this member',
  );
}
