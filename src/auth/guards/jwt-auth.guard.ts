// src/auth/jwt-auth.guard.ts
import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthService } from '../auth.service';
import { IS_PUBLIC_KEY } from '../public.decorator';
import { Reflector } from '@nestjs/core';


@Injectable()
export class JwtAuthGuard implements CanActivate {
    constructor(
        private reflector: Reflector,
        private authService: AuthService
    ) { }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);
        if (isPublic) {
            return true;
        }

        const request = context.switchToHttp().getRequest();
        if (await this.checkApiKey(request)) return true;

        // If no API key? check for Bearer token
        if (await this.checkJwtToken(request)) return true;
    }

    private async checkJwtToken(request: any): Promise<boolean> {
        const token = this.extractTokenFromHeader(request);
        if (!token) {
            throw new UnauthorizedException('Token not found');
        }
        try {
            const user = await this.authService.validateUser(token);
            request.user = user;
            return true;
        } catch (error) {
            throw new UnauthorizedException(error);
        }
    }

    private async checkApiKey(request: any): Promise<boolean> {
        request.user = {};
        const apiKey = request.headers['x-api-key'];
        if (apiKey) {
            const isValidApiKey = await this.authService.validateApiKey(apiKey);
            if (!isValidApiKey) {
                throw new UnauthorizedException('Invalid API key');
            }
            request.user.id = isValidApiKey;
            return true;
        }
    }

    private extractTokenFromHeader(request): string | null {
        const authHeader = request.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return null;
        }
        return authHeader.split(' ')[1];
    }
}
