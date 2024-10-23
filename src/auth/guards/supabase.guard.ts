import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { AuthService } from "../auth.service";

// AuthGuard implementation using the AuthService
// AuthGuard implementation using the AuthService
@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  constructor(private authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    // const apiKey = request.headers['x-api-key'];
    const authHeader = request.headers['authorization'];

    // Check if API key is provided
    // if (apiKey) {
    //   const isValidApiKey = await this.authService.validateApiKey(apiKey);
    //   if (!isValidApiKey) {
    //     throw new UnauthorizedException('Invalid API key');
    //   }
    //   return true;
    // }

    // If no API key, check for Bearer token
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

    // Attach user to request object for use in subsequent controllers
    request.user = user;
    return true;
  }
}