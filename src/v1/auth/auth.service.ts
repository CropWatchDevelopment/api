import { BadRequestException, Injectable } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import { getAccessToken, getUserId } from 'src/supabase/supabase-token.helper';

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
}
