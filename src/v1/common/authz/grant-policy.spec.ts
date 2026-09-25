import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PermissionLevel } from '../permission-levels';
import { assertCanGrant, type GrantCheck } from './grant-policy';

const check = (overrides: {
  actor?: Partial<GrantCheck['actor']>;
  target?: Partial<GrantCheck['target']>;
  newLevel?: number;
}): GrantCheck => ({
  actor: {
    isStaff: false,
    isOwner: false,
    level: PermissionLevel.MANAGER,
    ...overrides.actor,
  },
  target: {
    isResourceOwner: false,
    isSelf: false,
    currentLevel: null,
    ...overrides.target,
  },
  newLevel: overrides.newLevel,
});

describe('assertCanGrant — grant ceiling (security defect #2)', () => {
  it('a Manager granting Admin is denied', () => {
    expect(() =>
      assertCanGrant(check({ newLevel: PermissionLevel.ADMIN })),
    ).toThrow(ForbiddenException);
  });

  it('a Manager granting Manager or weaker is allowed', () => {
    for (const level of [
      PermissionLevel.MANAGER,
      PermissionLevel.USER,
      PermissionLevel.VIEWER,
      PermissionLevel.DISABLED,
    ]) {
      expect(() => assertCanGrant(check({ newLevel: level }))).not.toThrow();
    }
  });

  it("touching the resource owner's row is denied, even for an Admin", () => {
    expect(() =>
      assertCanGrant(
        check({
          actor: { level: PermissionLevel.ADMIN },
          target: { isResourceOwner: true },
          newLevel: PermissionLevel.VIEWER,
        }),
      ),
    ).toThrow(ForbiddenException);
    // ...and for a removal too.
    expect(() =>
      assertCanGrant(check({ target: { isResourceOwner: true } })),
    ).toThrow(ForbiddenException);
  });

  it('raising your own level is denied', () => {
    expect(() =>
      assertCanGrant(
        check({
          target: { isSelf: true, currentLevel: PermissionLevel.MANAGER },
          newLevel: PermissionLevel.MANAGER,
        }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('removing your own row (leaving) is allowed', () => {
    expect(() =>
      assertCanGrant(
        check({
          target: { isSelf: true, currentLevel: PermissionLevel.MANAGER },
        }),
      ),
    ).not.toThrow();
  });

  it("a Manager editing or removing an Admin's row is denied", () => {
    expect(() =>
      assertCanGrant(
        check({
          target: { currentLevel: PermissionLevel.ADMIN },
          newLevel: PermissionLevel.VIEWER,
        }),
      ),
    ).toThrow(ForbiddenException);
    expect(() =>
      assertCanGrant(
        check({ target: { currentLevel: PermissionLevel.ADMIN } }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('an actor without manage access is denied outright', () => {
    for (const level of [
      PermissionLevel.USER,
      PermissionLevel.VIEWER,
      PermissionLevel.DISABLED,
      null,
    ]) {
      expect(() =>
        assertCanGrant(
          check({ actor: { level }, newLevel: PermissionLevel.VIEWER }),
        ),
      ).toThrow(ForbiddenException);
    }
  });

  it('the implicit owner can grant any level, including Admin', () => {
    expect(() =>
      assertCanGrant(
        check({
          actor: { isOwner: true, level: null },
          newLevel: PermissionLevel.ADMIN,
        }),
      ),
    ).not.toThrow();
  });

  it('staff bypass everything', () => {
    expect(() =>
      assertCanGrant(
        check({
          actor: { isStaff: true, level: null },
          target: { isResourceOwner: true },
          newLevel: PermissionLevel.ADMIN,
        }),
      ),
    ).not.toThrow();
  });

  it('rejects out-of-range levels', () => {
    for (const bad of [0, 6, 2.5, -1]) {
      expect(() =>
        assertCanGrant(check({ actor: { isOwner: true }, newLevel: bad })),
      ).toThrow(BadRequestException);
    }
  });
});
