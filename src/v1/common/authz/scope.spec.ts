import type { AuthenticatedUser } from '../../auth/authenticated-user';
import {
  applyDeviceManageScope,
  applyDeviceReadScope,
  applyLocationManageScope,
  applyLocationReadScope,
  type ScopedQuery,
} from './scope';
import { PermissionLevel } from '../permission-levels';

/** Chainable fake that records every filter call in order. */
class FakeQuery implements ScopedQuery<FakeQuery> {
  calls: Array<[string, ...unknown[]]> = [];
  eq(column: string, value: unknown): FakeQuery {
    this.calls.push(['eq', column, value]);
    return this;
  }
  lt(column: string, value: unknown): FakeQuery {
    this.calls.push(['lt', column, value]);
    return this;
  }
  lte(column: string, value: unknown): FakeQuery {
    this.calls.push(['lte', column, value]);
    return this;
  }
  or(filters: string): FakeQuery {
    this.calls.push(['or', filters]);
    return this;
  }
}

const USER: AuthenticatedUser = {
  sub: '11111111-2222-3333-4444-555555555555',
  email: 'user@example.com',
  isStaff: false,
};
const STAFF: AuthenticatedUser = {
  sub: '99999999-8888-7777-6666-555555555555',
  email: 'support@cropwatch.io',
  isStaff: true,
};

describe('scope helpers', () => {
  it('device read scope: own row below DISABLED, or direct owner', () => {
    const q = new FakeQuery();
    applyDeviceReadScope(q, USER);
    expect(q.calls).toEqual([
      ['eq', 'owner_match.user_id', USER.sub],
      ['lt', 'owner_match.permission_level', PermissionLevel.DISABLED],
      ['or', `user_id.eq.${USER.sub},owner_match.not.is.null`],
    ]);
  });

  it('device manage scope defaults to the Manager ceiling', () => {
    const q = new FakeQuery();
    applyDeviceManageScope(q, USER);
    expect(q.calls).toEqual([
      ['eq', 'owner_match.user_id', USER.sub],
      ['lte', 'owner_match.permission_level', PermissionLevel.MANAGER],
      ['or', `user_id.eq.${USER.sub},owner_match.not.is.null`],
    ]);
  });

  it('device manage scope accepts a stricter ceiling (Admin-only)', () => {
    const q = new FakeQuery();
    applyDeviceManageScope(q, USER, PermissionLevel.ADMIN);
    expect(q.calls[1]).toEqual([
      'lte',
      'owner_match.permission_level',
      PermissionLevel.ADMIN,
    ]);
  });

  it('location scopes anchor the OR on owner_id, not user_id', () => {
    const read = new FakeQuery();
    applyLocationReadScope(read, USER);
    expect(read.calls[2]).toEqual([
      'or',
      `owner_id.eq.${USER.sub},owner_match.not.is.null`,
    ]);

    const manage = new FakeQuery();
    applyLocationManageScope(manage, USER);
    expect(manage.calls).toEqual([
      ['eq', 'owner_match.user_id', USER.sub],
      ['lte', 'owner_match.permission_level', PermissionLevel.MANAGER],
      ['or', `owner_id.eq.${USER.sub},owner_match.not.is.null`],
    ]);
  });

  it('staff bypass every filter', () => {
    for (const apply of [
      applyDeviceReadScope,
      applyDeviceManageScope,
      applyLocationReadScope,
      applyLocationManageScope,
    ]) {
      const q = new FakeQuery();
      apply(q, STAFF);
      expect(q.calls).toEqual([]);
    }
  });
});
