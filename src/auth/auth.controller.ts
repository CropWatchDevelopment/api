import { Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from './guards/jwt.auth.guard';
import { ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';

@Controller('auth')
@ApiBearerAuth('bearerAuth')
@ApiSecurity('apiKey')
export class AuthController {

    @Get()
    @UseGuards(JwtAuthGuard)
    async protected(@Req() req) {
        return req.user;
    }

    @Post('login')
    async login() {
        // Implement your login logic here
        return { message: 'Login endpoint' };
    }
}
