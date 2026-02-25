import { UnauthorizedException } from "@nestjs/common";
/*********************************************************************
   * 
   * Private functions to handle common tasks such as extracting user ID from JWT payload,
   * 
   ********************************************************************/

export function getUserId(jwtPayload: any): string {
    const userId = jwtPayload?.sub;
    if (typeof userId !== 'string' || !userId.trim()) {
        throw new UnauthorizedException('Invalid bearer token');
    }
    return userId;
}

export function getAccessToken(authHeader: string): string {
    const rawHeader = authHeader?.trim() ?? '';
    const [scheme, token] = rawHeader.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
        throw new UnauthorizedException('Missing bearer token');
    }
    return token;
}