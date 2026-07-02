/**
 * The authenticated caller, as attached to `request.user` by
 * {@link SupabaseStrategy.validate}. This is the only shape services
 * should accept — never the raw JWT payload.
 */
export interface AuthenticatedUser {
  /** Supabase user id (JWT `sub` claim, UUID). */
  sub: string;
  /** Caller email, trimmed and lowercased; null when the token has none. */
  email: string | null;
  /**
   * True when the caller is CropWatch staff. Single source of truth for
   * global read access — computed once at token validation.
   */
  isStaff: boolean;
}
