import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { OrgOwnerGuard } from './org-owner.guard';
import type { AccessService } from './access.service';
import { emptyOrgContext } from './org-context';
import type { AuthenticatedUser } from '../../auth/authenticated-user';

const context = (user?: AuthenticatedUser): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as unknown as ExecutionContext;

const guardWith = (role: 'owner' | 'manager' | 'member' | null) => {
  const ctx = emptyOrgContext(false);
  if (role) {
    ctx.org = { id: 'org-1', type: 'company', name: 'Acme', role };
  }
  return new OrgOwnerGuard({
    getOrgContext: jest.fn().mockResolvedValue(ctx),
  } as unknown as AccessService);
};

const user = (isStaff = false): AuthenticatedUser => ({
  sub: 'user-1',
  email: isStaff ? 'support@cropwatch.io' : 'user@example.com',
  isStaff,
});

describe('OrgOwnerGuard (billing is owner-only)', () => {
  it('passes the org owner', async () => {
    await expect(guardWith('owner').canActivate(context(user()))).resolves.toBe(
      true,
    );
  });

  it('passes staff without any org lookup', async () => {
    const access = { getOrgContext: jest.fn() } as unknown as AccessService;
    const guard = new OrgOwnerGuard(access);
    await expect(guard.canActivate(context(user(true)))).resolves.toBe(true);
    expect(
      (access as unknown as { getOrgContext: jest.Mock }).getOrgContext,
    ).not.toHaveBeenCalled();
  });

  it('rejects managers, members, and the org-less', async () => {
    for (const role of ['manager', 'member', null] as const) {
      await expect(
        guardWith(role).canActivate(context(user())),
      ).rejects.toBeInstanceOf(ForbiddenException);
    }
  });

  it('rejects a missing user (guard misordered before auth)', async () => {
    await expect(
      guardWith('owner').canActivate(context(undefined)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
