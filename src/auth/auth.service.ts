// Import necessary modules from Supabase and NestJS
import { Injectable, UnauthorizedException, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { SupabaseClient, createClient } from '@supabase/supabase-js';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AuthService {
  private supabase: SupabaseClient;

  constructor(
    private configService: ConfigService,
    // private jwtService: JwtService,
  ) {
    const supabaseUrl = this.configService.get<string>('SUPABASE_URL');
    const supabaseKey = this.configService.get<string>('SUPABASE_KEY');

    // Initialize Supabase client with version 2 package
    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  // Function to validate a JWT token using Supabase
  async validateUser(token: string): Promise<any> {
    try {
      // Fix: getSession doesn't take parameters in this version
      const { data, error } = await this.supabase.auth.getSession();
      
      if (error) {
        throw new UnauthorizedException(error.message);
      }
      
      // If we have a session but want to validate a specific token
      if (!data.session || data.session.access_token !== token) {
        // Try to get user info directly
        const { data: userData, error: userError } = await this.supabase.auth.getUser(token);
        if (userError) {
          throw new UnauthorizedException(userError.message);
        }
        return userData.user;
      }
      
      return data.session?.user;
    } catch (error) {
      throw new UnauthorizedException(error.message);
    }
  }

  async validateApiKey(apiKey: string): Promise<string> {
    // Here you would implement logic to validate the API key
    // For now, we assume a hardcoded valid key for demonstration purposes

    let { data: user_api_keys, error } = await this.supabase
      .from('api_keys')
      .select('*')
      .eq('api_key', apiKey)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (error) {
      throw new UnauthorizedException('Invalid API key');
    }

    if (!user_api_keys) {
      throw new UnauthorizedException('API key not found');
    }

    return user_api_keys.owner_id;
  }

  // Function to sign in with email and password
  async signInWithEmail(email: string, password: string): Promise<any> {
    try {
      const { data: session, error } = await this.supabase.auth.signInWithPassword({ email, password });
      if (error) {
        throw new UnauthorizedException('Invalid credentials');
      }
      // this.jwtService.sign(session);
      return session;
    } catch (error) {
      throw new UnauthorizedException(
        'Unable to sign in with email and password',
      );
    }
  }
}