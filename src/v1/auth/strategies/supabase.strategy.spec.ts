import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { SupabaseStrategy } from './supabase.strategy';

const VALID_SUB = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

function makeConfig(
  overrides: Record<string, string | undefined> = {},
): ConfigService {
  const values: Record<string, string | undefined> = {
    PRIVATE_SUPABASE_JWT_SECRET: 'test-secret',
    PRIVATE_SUPABASE_URL: 'https://proj.supabase.co',
    ...overrides,
  };
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

describe('SupabaseStrategy', () => {
  describe('constructor', () => {
    it('throws when the JWT secret is not configured', () => {
      expect(
        () =>
          new SupabaseStrategy(
            makeConfig({ PRIVATE_SUPABASE_JWT_SECRET: undefined }),
          ),
      ).toThrow('PRIVATE_SUPABASE_JWT_SECRET is not configured');
    });

    it('throws when the Supabase URL is not configured', () => {
      expect(
        () =>
          new SupabaseStrategy(makeConfig({ PRIVATE_SUPABASE_URL: undefined })),
      ).toThrow('PRIVATE_SUPABASE_URL is not configured');
    });
  });

  describe('validate', () => {
    const strategy = new SupabaseStrategy(makeConfig());

    it('returns the authenticated user for a valid UUID sub', () => {
      expect(
        strategy.validate({ sub: VALID_SUB, email: 'User@Example.com' }),
      ).toEqual({
        sub: VALID_SUB,
        email: 'user@example.com',
        isStaff: false,
      });
    });

    it('flags @cropwatch.io callers as staff', () => {
      expect(
        strategy.validate({ sub: VALID_SUB, email: 'ops@cropwatch.io' }),
      ).toMatchObject({ isStaff: true });
    });

    it('trims surrounding whitespace before validating the sub', () => {
      expect(
        strategy.validate({ sub: `  ${VALID_SUB}  `, email: null }),
      ).toMatchObject({ sub: VALID_SUB });
    });

    it('rejects a non-UUID sub', () => {
      expect(() => strategy.validate({ sub: 'not-a-uuid' })).toThrow(
        UnauthorizedException,
      );
    });

    it('rejects a missing sub', () => {
      expect(() => strategy.validate({})).toThrow(UnauthorizedException);
    });

    it('rejects a null payload', () => {
      expect(() => strategy.validate(null)).toThrow(UnauthorizedException);
    });
  });
});
