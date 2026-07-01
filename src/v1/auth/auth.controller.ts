import { Body, Controller, Get, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from './guards/jwt.auth.guard';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiInternalServerErrorResponse,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { LoginResponseDto } from './dto/login-response.dto';
import { UpdateUserProfileDto } from './dto/update-user-profile.dto';
import { UpdateEmailDto } from './dto/update-email.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';

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

  @Get('user-profile')
  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({
    description: 'Authenticated user profile returned successfully.',
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
  async getUserProfile(@Req() req) {
    return this.authService.getUserProfile(req.user, req.headers?.authorization, req.user);
  }

  @Patch('user-profile')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Update the authenticated user profile' })
  @ApiOkResponse({
    description: 'User profile updated successfully.',
    schema: { type: 'object', additionalProperties: true },
  })
  @ApiBadRequestResponse({
    description: 'Invalid profile payload.',
    type: ErrorResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid bearer token.',
    type: ErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'Username is already taken by another user.',
    type: ErrorResponseDto,
    example: {
      statusCode: 409,
      error: 'Conflict',
      message: 'Username is already taken',
    },
  })
  @ApiInternalServerErrorResponse({
    description: 'Failed to update user profile.',
    type: ErrorResponseDto,
  })
  async updateUserProfile(@Body() body: UpdateUserProfileDto, @Req() req) {
    return this.authService.updateUserProfile(body, req.headers?.authorization, req.user);
  }

  @Patch('email')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Start a verified email change for the authenticated user' })
  @ApiOkResponse({
    description: 'Confirmation email sent; the change applies once confirmed.',
    schema: { type: 'object', additionalProperties: true },
  })
  @ApiBadRequestResponse({
    description: 'Invalid or unavailable email address.',
    type: ErrorResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid bearer token.',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'CropWatch (cropwatch.io / cropwatch.co.jp) accounts cannot change their email.',
    type: ErrorResponseDto,
  })
  @ApiInternalServerErrorResponse({
    description: 'Failed to start email change.',
    type: ErrorResponseDto,
  })
  async updateEmail(@Body() body: UpdateEmailDto, @Req() req) {
    return this.authService.updateEmail(req.headers?.authorization, body.email, req.user);
  }

  @Get('preferences')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get the authenticated user preferences (creates on first access)' })
  @ApiOkResponse({
    description: 'User preferences returned successfully.',
    schema: { type: 'object', additionalProperties: true },
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid bearer token.',
    type: ErrorResponseDto,
  })
  @ApiInternalServerErrorResponse({
    description: 'Failed to read preferences.',
    type: ErrorResponseDto,
  })
  async getPreferences(@Req() req) {
    return this.authService.getPreferences(req.user, req.headers?.authorization);
  }

  @Patch('preferences')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Update the authenticated user preferences' })
  @ApiOkResponse({
    description: 'User preferences updated successfully.',
    schema: { type: 'object', additionalProperties: true },
  })
  @ApiBadRequestResponse({
    description: 'Invalid preferences payload.',
    type: ErrorResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid bearer token.',
    type: ErrorResponseDto,
  })
  @ApiInternalServerErrorResponse({
    description: 'Failed to update preferences.',
    type: ErrorResponseDto,
  })
  async updatePreferences(@Body() body: UpdatePreferencesDto, @Req() req) {
    return this.authService.updatePreferences(body, req.headers?.authorization, req.user);
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
}
