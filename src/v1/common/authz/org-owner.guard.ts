import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../../auth/authenticated-user';
import { AccessService } from './access.service';

/**
 * Money and structure are owner-only (plan section 4.2): the caller must be
 * the OWNER of their organization (or staff). Runs after JwtAuthGuard.
 * Every pre-organizations account owns its personal org, so existing users
 * pass unchanged; company managers/members and guests are rejected.
 */
@Injectable()
export class OrgOwnerGuard implements CanActivate {
  constructor(private readonly accessService: AccessService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();
    const user = request.user;
    if (!user) {
      throw new ForbiddenException('Owner only');
    }
    if (user.isStaff) {
      return true;
    }
    const ctx = await this.accessService.getOrgContext(user);
    if (ctx.org?.role === 'owner') {
      return true;
    }
    throw new ForbiddenException(
      'Only the organization owner can manage billing',
    );
  }
}
