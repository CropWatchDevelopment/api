// Usage Example in Controller
import { Controller, Get, UseGuards, Req, Body, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SupabaseAuthGuard } from './guards/supabase.guard';
import { LoginDto } from './DTOs/userAuth.dto';
import { AuthService } from './auth.service';
import { Public } from './public.decorator';
import { Throttle } from '@nestjs/throttler';

@ApiTags('Endpoints related to user authentication and authorization')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) { }

  @ApiBearerAuth('XYZ')
  @Get('user')
  @UseGuards(SupabaseAuthGuard)
  @ApiResponse({ status: 200, description: 'Login Success' })
  @ApiResponse({ status: 400, description: 'Bad Request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 402, description: 'Payment Required' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Login Not Found', type: LoginDto, links: {
    exampleLink: {
      operationId: 'getUserById',
        parameters: {
          userId: '$request.path.id',
        },
        description: 'Link to get user by ID',
        server: {
          url: 'https://api.cropwatch.io/api/auth/user',
        }
    }
  } })
  async getProtectedRoute(@Req() req) {
    return { message: 'This is a protected route', user: req.user };
  }

  @Public()
  @Post('login')
  @Throttle({ default: { limit: 1, ttl: 6000 } })
  @ApiResponse({ status: 200, description: 'Login Success' })
  @ApiResponse({ status: 400, description: 'Bad Request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 402, description: 'Payment Required' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Login Not Found' })
  async login(@Body() loginDto: LoginDto) {
    const session = await this.authService.signInWithEmail(loginDto.email, loginDto.password);
    return { message: 'Login successful', token: session.session?.access_token };
  }
}
