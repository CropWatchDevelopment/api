// Usage Example in Controller
import { Controller, Get, UseGuards, Req, Body, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SupabaseAuthGuard } from './guards/supabase.guard';
import { LoginDto } from './DTOs/userAuth.dto';
import { AuthService } from './auth.service';
import { Public } from './public.decorator';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @ApiBearerAuth('XYZ')
  @Get('user')
  @UseGuards(SupabaseAuthGuard)
  async getProtectedRoute(@Req() req) {
    return { message: 'This is a protected route', user: req.user };
  }

  @Public()
  @Post('login')
  async login(@Body() loginDto: LoginDto) {
    const session = await this.authService.signInWithEmail(loginDto.email, loginDto.password);
    return { message: 'Login successful', token: session.session?.access_token };
  }
}
