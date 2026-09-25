import { ForbiddenException } from '@nestjs/common';
import {
  assertCanEditMember,
  assertCanInvite,
  assertCanRemove,
  assertCanSuspend,
  inviteableRoles,
} from './org-role-policy';

describe('org role policy (plan section 4.3)', () => {
  describe('invites', () => {
    it('owner invites anyone; manager invites members and managers only', () => {
      expect(inviteableRoles('owner')).toEqual(['manager', 'member', 'guest']);
      expect(inviteableRoles('manager')).toEqual(['manager', 'member']);
      expect(inviteableRoles('member')).toEqual([]);
      expect(inviteableRoles(null)).toEqual([]);
    });

    it('a manager inviting a guest is denied (guests are owner-only)', () => {
      expect(() => assertCanInvite('manager', 'guest')).toThrow(
        ForbiddenException,
      );
      expect(() => assertCanInvite('owner', 'guest')).not.toThrow();
    });
  });

  describe('member edits', () => {
    it('a manager demoting or editing another manager is denied', () => {
      expect(() =>
        assertCanEditMember('manager', 'manager', false, 'member'),
      ).toThrow(ForbiddenException);
    });

    it('a manager cannot promote a member to manager', () => {
      expect(() =>
        assertCanEditMember('manager', 'member', false, 'manager'),
      ).toThrow(ForbiddenException);
      expect(() =>
        assertCanEditMember('owner', 'member', false, 'manager'),
      ).not.toThrow();
    });

    it('nobody edits the owner or themselves', () => {
      expect(() => assertCanEditMember('owner', 'owner', false)).toThrow(
        ForbiddenException,
      );
      expect(() => assertCanEditMember('owner', 'manager', true)).toThrow(
        ForbiddenException,
      );
    });

    it('guests are owner-only', () => {
      expect(() => assertCanEditMember('manager', 'guest', false)).toThrow(
        ForbiddenException,
      );
      expect(() => assertCanEditMember('owner', 'guest', false)).not.toThrow();
    });
  });

  describe('suspension', () => {
    it('owner suspends anyone except themselves; the owner is untouchable', () => {
      expect(() => assertCanSuspend('owner', 'manager', false)).not.toThrow();
      expect(() => assertCanSuspend('owner', 'guest', false)).not.toThrow();
      expect(() => assertCanSuspend('owner', 'owner', true)).toThrow(
        ForbiddenException,
      );
    });

    it('a manager suspending a manager or guest is denied; members are fine', () => {
      expect(() => assertCanSuspend('manager', 'member', false)).not.toThrow();
      expect(() => assertCanSuspend('manager', 'manager', false)).toThrow(
        ForbiddenException,
      );
      expect(() => assertCanSuspend('manager', 'guest', false)).toThrow(
        ForbiddenException,
      );
    });
  });

  describe('removal', () => {
    it('anyone except the owner may leave', () => {
      expect(() => assertCanRemove('member', 'member', true)).not.toThrow();
      expect(() => assertCanRemove('guest', 'guest', true)).not.toThrow();
      expect(() => assertCanRemove('owner', 'owner', true)).toThrow(
        ForbiddenException,
      );
    });

    it('managers remove members only; the owner removes anyone', () => {
      expect(() => assertCanRemove('manager', 'member', false)).not.toThrow();
      expect(() => assertCanRemove('manager', 'manager', false)).toThrow(
        ForbiddenException,
      );
      expect(() => assertCanRemove('owner', 'manager', false)).not.toThrow();
      expect(() => assertCanRemove('owner', 'guest', false)).not.toThrow();
    });
  });
});
