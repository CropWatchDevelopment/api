import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { AuthService } from "../auth.service";
import { User } from "@supabase/supabase-js";

// AuthGuard implementation using the AuthService
// AuthGuard implementation using the AuthService
@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  constructor(private authService: AuthService) { }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const apiKey = this.getApiKey(request);
    const authHeader = this.getAuthHeader(request);

    // Check if API key is provided
    if (apiKey) {
      await this.validateApiKey(apiKey);
      return true;
    }

    // If no API key, check for Bearer token
    if (authHeader) {
      request.user = await this.validateBearerToken(authHeader);
      return true;
    }
  }



  private getApiKey(request: any): string | undefined {
    return request.headers['x-api-key'];
  }

  private getAuthHeader(request: any): string | undefined {
    return request.headers['authorization'];
  }

  private async validateApiKey(apiKey: string): Promise<boolean> {
    if (apiKey) {
      const isValidApiKey = await this.authService.validateApiKey(apiKey);
      if (!isValidApiKey) {
        throw new UnauthorizedException('Invalid API key');
      }
      return true;
    }
  }

  private async validateBearerToken(authHeader: string): Promise<User> {
    if (!authHeader) {
      throw new UnauthorizedException('Authorization header not found');
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      throw new UnauthorizedException('Invalid authorization token format');
    }

    const user = await this.authService.validateUser(token);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return user;
  }
}