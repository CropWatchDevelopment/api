import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from './guards/jwt.auth.guard';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiInternalServerErrorResponse,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { LoginResponseDto } from './dto/login-response.dto';
import { RegisterDto, RegisterResponseDto } from './dto/register.dto';

@Controller({ path: 'auth', version: '1' })
@ApiBearerAuth('bearerAuth')
@ApiSecurity('apiKey')
export class AuthController {
  constructor(private readonly authService: AuthService) { }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({
    description: 'Authenticated user returned successfully.',
    schema: { type: 'object', additionalProperties: true },
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid bearer token.',
    type: ErrorResponseDto,
    example: {
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Unauthorized',
    },
  })
  async protected(@Req() req) {
    return req.user;
  }

  @Throttle({ default: { limit: 2, ttl: 60000 } })
  @Post('login')
  @ApiOperation({ summary: 'Login with email and password' })
  @ApiOkResponse({
    description: 'Login successful. Returns access token and user data.',
    type: LoginResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid login payload.',
    type: ErrorResponseDto,
    example: {
      statusCode: 400,
      error: 'Bad Request',
      message: 'Validation failed',
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid email or password.',
    type: ErrorResponseDto,
    example: {
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Invalid email or password',
    },
  })
  @ApiInternalServerErrorResponse({
    description: 'Failed to login.',
    type: ErrorResponseDto,
    example: {
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'Failed to login',
    },
  })
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


  // @Throttle({ default: { limit: 3, ttl: 60000 } })
  // @Post('register')
  // @ApiOperation({ summary: 'Register a new user with name, company, and consent agreements' })
  // @ApiOkResponse({
  //   description: 'Registration successful. Returns access token and user data.',
  //   type: RegisterResponseDto,
  // })
  // @ApiBadRequestResponse({
  //   description: 'Invalid registration payload or missing required agreements.',
  //   type: ErrorResponseDto,
  //   example: {
  //     statusCode: 400,
  //     error: 'Bad Request',
  //     message: 'Validation failed',
  //   },
  // })
  // @ApiInternalServerErrorResponse({
  //   description: 'Failed to register.',
  //   type: ErrorResponseDto,
  //   example: {
  //     statusCode: 500,
  //     error: 'Internal Server Error',
  //     message: 'Failed to register',
  //   },
  // })
  // async register(@Body() body: RegisterDto) {
  //   return this.authService.register(body);
  // }
}
