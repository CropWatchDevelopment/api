import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import { getAccessToken, getUserId } from '../../supabase/supabase-token.helper';
import { UpdateUserProfileDto } from './dto/update-user-profile.dto';

@Injectable()
export class AuthService {
  constructor(private readonly supabaseService: SupabaseService) {}

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
}
