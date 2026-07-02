import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { isStaffEmail } from '../../common/owner-filter.helper';
import type { AuthenticatedUser } from '../authenticated-user';

@Injectable()
export class SupabaseStrategy extends PassportStrategy(Strategy) {
  public constructor(private readonly configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('PRIVATE_SUPABASE_JWT_SECRET'),
    });
  }

  /**
   * Maps the verified Supabase JWT payload to the AuthenticatedUser shape
   * attached to `request.user`. This is the single place raw JWT claims
   * are read — everything downstream consumes AuthenticatedUser.
   */
  validate(payload: unknown): AuthenticatedUser {
    const claims = (payload ?? {}) as Record<string, unknown>;

    const sub = typeof claims.sub === 'string' ? claims.sub.trim() : '';
    if (!sub) {
      throw new UnauthorizedException('Invalid bearer token');
    }

    const email =
      typeof claims.email === 'string' && claims.email.trim()
        ? claims.email.trim().toLowerCase()
        : null;

    return { sub, email, isStaff: isStaffEmail(email) };
  }
}
