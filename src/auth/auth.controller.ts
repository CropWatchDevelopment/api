import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from './guards/jwt.auth.guard';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';

@Controller('auth')
@ApiBearerAuth('bearerAuth')
@ApiSecurity('apiKey')
export class AuthController {
    constructor(private readonly authService: AuthService) {}

    @Get()
    @UseGuards(JwtAuthGuard)
    async protected(@Req() req) {
        return req.user;
    }

    @Post('login')
    @ApiOperation({ summary: 'Login with email and password' })
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                email: { type: 'string', example: 'user@example.com' },
                password: { type: 'string', example: 'StrongPassword123!' },
            },
            required: ['email', 'password'],
        },
    })
    async login(@Body() body: { email: string; password: string }) {
        return this.authService.loginWithPassword(body.email, body.password);
    }
}
