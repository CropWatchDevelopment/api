import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { isUUID } from 'class-validator';
import { isStaffEmail } from '../../common/owner-filter.helper';
import type { AuthenticatedUser } from '../authenticated-user';

@Injectable()
export class SupabaseStrategy extends PassportStrategy(Strategy) {
  public constructor(configService: ConfigService) {
    const secret = configService.get<string>('PRIVATE_SUPABASE_JWT_SECRET');
    if (!secret) {
      throw new Error('PRIVATE_SUPABASE_JWT_SECRET is not configured');
    }
    const supabaseUrl = configService.get<string>('PRIVATE_SUPABASE_URL');
    if (!supabaseUrl) {
      throw new Error('PRIVATE_SUPABASE_URL is not configured');
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
      // Pin verification to exactly the tokens Supabase GoTrue issues for this
      // project. Without these, any HS* token signed with the shared secret —
      // whatever its issuer or audience — would be accepted (the project's own
      // anon/service_role keys are not JWTs under the new sb_ format, but a
      // token minted elsewhere with the same secret would otherwise pass).
      // NOTE: Supabase currently signs user tokens with HS256 (symmetric). If the
      // project later moves to asymmetric JWT signing keys, swap `secretOrKey`
      // for a JWKS `secretOrKeyProvider` and update `algorithms` accordingly.
      algorithms: ['HS256'],
      issuer: `${supabaseUrl.replace(/\/+$/, '')}/auth/v1`,
      audience: 'authenticated',
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
    // `sub` is interpolated into PostgREST `.or(...)` filter strings across the
    // data services, so require a real UUID (the shape Supabase always issues)
    // rather than merely non-empty — this closes that string-injection surface.
    if (!isUUID(sub)) {
      throw new UnauthorizedException('Invalid bearer token');
    }

    const email =
      typeof claims.email === 'string' && claims.email.trim()
        ? claims.email.trim().toLowerCase()
        : null;

    return { sub, email, isStaff: isStaffEmail(email) };
  }
}
