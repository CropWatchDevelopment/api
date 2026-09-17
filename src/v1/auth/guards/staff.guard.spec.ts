import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { StaffGuard } from './staff.guard';

const contextFor = (user: unknown): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as unknown as ExecutionContext;

describe('StaffGuard', () => {
  const guard = new StaffGuard();

  it('allows staff users', () => {
    expect(
      guard.canActivate(
        contextFor({ sub: 'u1', email: 'a@cropwatch.io', isStaff: true }),
      ),
    ).toBe(true);
  });

  it('rejects non-staff users', () => {
    expect(() =>
      guard.canActivate(
        contextFor({ sub: 'u1', email: 'a@example.com', isStaff: false }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('rejects requests with no authenticated user', () => {
    expect(() => guard.canActivate(contextFor(undefined))).toThrow(
      ForbiddenException,
    );
  });
});
