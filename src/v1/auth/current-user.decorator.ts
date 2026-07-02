import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from './authenticated-user';

/**
 * Injects the authenticated caller (`request.user`) into a route handler.
 * Only valid on routes protected by {@link JwtAuthGuard}.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser =>
    ctx.switchToHttp().getRequest<Request & { user: AuthenticatedUser }>()
      .user,
);
