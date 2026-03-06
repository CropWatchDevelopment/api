import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import { RegisterDto } from './dto/register.dto';

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
      .getClient()
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

  async register(dto: RegisterDto) {
    if (!dto.acceptedTerms || !dto.acceptedPrivacyPolicy || !dto.acceptedCookiePolicy) {
      throw new BadRequestException(
        'You must accept the Terms of Service, Privacy Policy, and Cookie Policy to register',
      );
    }

    const { data, error } = await this.supabaseService
      .getClient()
      .auth.signUp({
        email: dto.email,
        password: dto.password,
        options: {
          data: {
            full_name: `${dto.firstName} ${dto.lastName}`,
            employer: dto.companyName,
          },
        },
      });

    if (error) {
      throw new BadRequestException(error.message);
    }

    if (!data.user) {
      throw new InternalServerErrorException('Failed to create user account');
    }

    // Update the profile record created by the trigger with additional data
    const adminClient = this.supabaseService.getAdminClient();
    if (adminClient) {
      const { error: profileError } = await adminClient
        .from('profiles')
        .update({
          full_name: `${dto.firstName} ${dto.lastName}`,
          employer: dto.companyName,
          accepted_agreements: true,
          email: dto.email,
        })
        .eq('id', data.user.id);

      if (profileError) {
        console.error('Failed to update profile:', profileError.message);
      }
    }

    const session = data.session;
    const result: Record<string, unknown> = {
      userId: data.user.id,
    };

    if (session) {
      result.accessToken = session.access_token;
      result.token_type = session.token_type;
      result.expires_in_seconds = session.expires_in;
      result.expires_at = session.expires_at;
      result.expires_at_datetime = new Date((session.expires_at ?? 0) * 1000);
    }

    return {
      message: 'Registration successful.',
      result,
    };
  }
}
