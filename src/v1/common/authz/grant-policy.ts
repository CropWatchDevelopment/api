/**
 * The grant ceiling: who may create, change, or remove someone else's
 * permission row on a location or device.
 *
 * This closes the "no grant ceiling" defect: before this module a Manager
 * could grant Admin, rewrite or delete the implicit owner's row, or raise
 * their own level. The rules, in today's five-level terms:
 *
 *  - Staff bypass everything.
 *  - The actor needs manage access to the resource (owner, Admin, or
 *    Manager) — callers scope-check first; this re-asserts defensively.
 *  - Nobody can touch the implicit resource owner's access.
 *  - Nobody can change their OWN level. Removing your own row (leaving) is
 *    allowed.
 *  - You may only grant a level equal to or weaker than your own, and only
 *    change/remove rows of users at your level or weaker.
 *    (Owner ranks above Admin; lower number = stronger.)
 */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { MANAGE_CEILING, isValidPermissionLevel } from '../permission-levels';

export interface GrantCheck {
  actor: {
    isStaff: boolean;
    /** Implicit owner of the resource (outranks every level). */
    isOwner: boolean;
    /** The actor's permission level on the resource, or null when none. */
    level: number | null;
  };
  target: {
    /** The target user is the resource's implicit owner. */
    isResourceOwner: boolean;
    /** The target user is the actor themself. */
    isSelf: boolean;
    /** The target's existing level on the resource (null/undefined if new). */
    currentLevel?: number | null;
  };
  /** The level being granted; omit for a removal. */
  newLevel?: number;
}

/** Rank used for ceiling comparisons: implicit owner outranks Admin. */
const OWNER_RANK = 0;

/**
 * Throws ForbiddenException / BadRequestException when the grant violates
 * the ceiling; returns silently when it is allowed.
 */
export function assertCanGrant(check: GrantCheck): void {
  const { actor, target, newLevel } = check;

  if (actor.isStaff) {
    return;
  }

  const actorRank = actor.isOwner ? OWNER_RANK : actor.level;
  if (actorRank == null || actorRank > MANAGE_CEILING) {
    throw new ForbiddenException(
      'You do not have permission to manage access to this resource',
    );
  }

  if (target.isResourceOwner) {
    throw new ForbiddenException(
      "The resource owner's access cannot be changed",
    );
  }

  const isRemoval = newLevel === undefined;
  if (target.isSelf && !isRemoval) {
    throw new ForbiddenException('You cannot change your own access level');
  }

  if (!isRemoval) {
    if (!isValidPermissionLevel(newLevel)) {
      throw new BadRequestException('Invalid permission level');
    }
    if (newLevel < actorRank) {
      throw new ForbiddenException(
        'You cannot grant an access level higher than your own',
      );
    }
  }

  if (
    !target.isSelf &&
    target.currentLevel != null &&
    target.currentLevel < actorRank
  ) {
    throw new ForbiddenException(
      'You cannot change the access of a user with a higher level than your own',
    );
  }
}
