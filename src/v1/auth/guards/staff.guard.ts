import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../authenticated-user';

/**
 * Restricts a route to CropWatch staff. Must run AFTER {@link JwtAuthGuard},
 * which attaches the validated {@link AuthenticatedUser} to `request.user`:
 *
 *   @UseGuards(JwtAuthGuard, StaffGuard)
 */
@Injectable()
export class StaffGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();
    if (!request.user?.isStaff) {
      throw new ForbiddenException('Staff only');
    }
    return true;
  }
}
