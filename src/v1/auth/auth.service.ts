import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../../supabase/supabase.service';
import { getAccessToken, getUserId } from '../../supabase/supabase-token.helper';
import { UpdateUserProfileDto } from './dto/update-user-profile.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';

// Accounts on these domains are locked to their corporate identity and may not
// change their email address (checked against the caller's current email).
const RESTRICTED_EMAIL_CHANGE_DOMAINS = ['@cropwatch.io', '@cropwatch.co.jp'];

const PREFERENCE_KEYS = [
  'theme',
  'temperature_unit',
  'weight_unit',
  'ec_unit',
  'water_level_unit',
  'timezone',
  'distance_unit',
  'area_unit',
  'soil_moisture_unit',
  'pressure_unit',
  'rainfall_unit',
  'wind_speed_unit',
  'co2_unit',
  'date_format',
  'time_format',
] as const;

@Injectable()
export class AuthService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
  ) {}

  async loginWithPassword(email: string, password: string) {
    if (!email || !email.includes('@')) {
      throw new BadRequestException('Valid email is required');
    }
    if (!password) {
      throw new BadRequestException('Password is required');
    }

    const { data, error } = await this.supabaseService
      .getAuthClient()
      .auth.signInWithPassword({
        email,
        password,
      });

    if (error) {
      throw new BadRequestException(error.message);
    }

    const session = data.session;

    if (!session || !session.access_token) {
      throw new BadRequestException('Failed to obtain access token');
    }

    if (!session.expires_at) {
      throw new BadRequestException('Failed to obtain token expiration');
    }

    const result = {
      accessToken: session.access_token,
      token_type: session.token_type,
      expires_in_seconds: session.expires_in,
      expires_at: session.expires_at,
      expires_at_datetime: new Date(session.expires_at * 1000),
    };

    return {
      message: 'Login successful.',
      result,
    };
  }
  async getUserProfile(user: any, authHeader: string, jwtPayload: any) {
    const accessToken = getAccessToken(authHeader);
    const client = this.supabaseService.getClient(accessToken);
    const userId = getUserId(jwtPayload);
    const { data, error } = await client
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) {
      throw new BadRequestException('Failed to fetch user profile');
    }

    return data;
  }

  async updateUserProfile(
    updateDto: UpdateUserProfileDto,
    authHeader: string,
    jwtPayload: any,
  ) {
    const accessToken = getAccessToken(authHeader);
    const client = this.supabaseService.getClient(accessToken);
    const userId = getUserId(jwtPayload);

    const normalized: UpdateUserProfileDto = {};
    if (updateDto.full_name !== undefined) {
      normalized.full_name = updateDto.full_name?.trim() || null;
    }
    if (updateDto.username !== undefined) {
      normalized.username = updateDto.username?.trim() || null;
    }
    if (updateDto.website !== undefined) {
      normalized.website = updateDto.website?.trim() || null;
    }
    if (updateDto.employer !== undefined) {
      normalized.employer = updateDto.employer?.trim() || null;
    }
    if (updateDto.phone_number !== undefined) {
      normalized.phone_number = updateDto.phone_number?.trim() || null;
    }

    if (Object.keys(normalized).length === 0) {
      throw new BadRequestException('No profile fields provided to update');
    }

    // Defensive pre-check: username must be unique across all profiles.
    if (typeof normalized.username === 'string' && normalized.username.length > 0) {
      const { data: existing, error: lookupError } = await client
        .from('profiles')
        .select('id')
        .eq('username', normalized.username)
        .neq('id', userId)
        .limit(1)
        .maybeSingle();

      if (lookupError) {
        throw new InternalServerErrorException('Failed to verify username availability');
      }

      if (existing) {
        throw new ConflictException('Username is already taken');
      }
    }

    const { data, error } = await client
      .from('profiles')
      .update(normalized)
      .eq('id', userId)
      .select('*')
      .single();

    if (error) {
      // Postgres unique-violation, in case the DB has a constraint we bypassed above.
      if (error.code === '23505') {
        throw new ConflictException('Username is already taken');
      }
      throw new InternalServerErrorException('Failed to update user profile');
    }

    return data;
  }

  /**
   * Start a verified email change. Uses the USER's own access token against the
   * GoTrue REST endpoint so Supabase runs its secure email-change flow and emails
   * a confirmation link; the change only lands once the user confirms (verified by
   * the CropWatch /auth/confirm route). profiles.email is synced by the
   * on_auth_user_email_updated DB trigger after confirmation.
   */
  async updateEmail(authHeader: string, newEmail: string, jwtPayload: any) {
    const accessToken = getAccessToken(authHeader);

    // Corporate CropWatch accounts are locked to their email of record.
    const currentEmail = (jwtPayload?.email ?? '').toString().trim().toLowerCase();
    if (RESTRICTED_EMAIL_CHANGE_DOMAINS.some((domain) => currentEmail.endsWith(domain))) {
      throw new ForbiddenException(
        'CropWatch email addresses (cropwatch.io / cropwatch.co.jp) cannot change their email.',
      );
    }

    const email = newEmail?.trim() ?? '';
    if (!email || !email.includes('@')) {
      throw new BadRequestException('A valid email address is required');
    }

    const url = this.configService.get<string>('PRIVATE_SUPABASE_URL');
    const anonKey = this.configService.get<string>('PRIVATE_SUPABASE_ANON_KEY');
    if (!url || !anonKey) {
      throw new InternalServerErrorException('Supabase is not configured');
    }

    // supabase-js updateUser() needs a persisted session; we only hold the
    // access token, so call GoTrue's PUT /user directly with the user's bearer.
    const response = await fetch(`${url}/auth/v1/user`, {
      method: 'PUT',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as {
        msg?: string;
        error_description?: string;
        message?: string;
      };
      const message =
        payload.msg || payload.error_description || payload.message || 'Failed to start email change';
      if (response.status === 401) {
        throw new UnauthorizedException(message);
      }
      if (response.status === 400 || response.status === 422) {
        throw new BadRequestException(message);
      }
      throw new InternalServerErrorException(message);
    }

    return {
      pending: true,
      message: 'Confirmation email sent. Check your inbox to complete the change.',
    };
  }

  /** Read the caller's preferences, creating an empty row on first access. */
  async getPreferences(jwtPayload: any, authHeader: string) {
    const accessToken = getAccessToken(authHeader);
    const client = this.supabaseService.getClient(accessToken);
    const userId = getUserId(jwtPayload);

    const { data, error } = await client
      .from('profile_preferences')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) {
      throw new InternalServerErrorException('Failed to read preferences');
    }
    if (data) {
      return data;
    }

    const { data: inserted, error: insertError } = await client
      .from('profile_preferences')
      .upsert({ user_id: userId }, { onConflict: 'user_id', ignoreDuplicates: false })
      .select('*')
      .single();
    if (insertError || !inserted) {
      throw new InternalServerErrorException('Failed to create preferences');
    }
    return inserted;
  }

  /** Patch the caller's preferences (get-or-create + merge in a single upsert). */
  async updatePreferences(
    updateDto: UpdatePreferencesDto,
    authHeader: string,
    jwtPayload: any,
  ) {
    const accessToken = getAccessToken(authHeader);
    const client = this.supabaseService.getClient(accessToken);
    const userId = getUserId(jwtPayload);

    const patch: UpdatePreferencesDto = {};
    for (const key of PREFERENCE_KEYS) {
      if (updateDto[key] !== undefined) {
        const value = updateDto[key];
        patch[key] = typeof value === 'string' && value.trim() === '' ? null : value;
      }
    }

    if (Object.keys(patch).length === 0) {
      throw new BadRequestException('No preference fields provided to update');
    }

    const { data, error } = await client
      .from('profile_preferences')
      .upsert(
        { user_id: userId, ...patch, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' },
      )
      .select('*')
      .single();

    if (error) {
      throw new InternalServerErrorException('Failed to update preferences');
    }

    return data;
  }
}
