import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiSecurity,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt.auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { AiRecommendationsService } from './ai-recommendations.service';
import {
  AI_REPORT_TYPES,
  AiRecommendationDto,
  type AiReportType,
} from './dto/ai-recommendation.dto';

export const AI_RECOMMENDATIONS_MAX_LIMIT = 31;

@Controller({ path: 'devices', version: '1' })
@ApiBearerAuth('bearerAuth')
@ApiSecurity('apiKey')
@UseGuards(JwtAuthGuard)
export class AiRecommendationsController {
  constructor(private readonly aiRecommendations: AiRecommendationsService) {}

  @Get(':dev_eui/ai-recommendations')
  @ApiOperation({
    summary: "Get a soil sensor's AI growing-environment reports",
    description:
      'Daily or weekly reports from the CropWatch AI worker, newest period first: status, headline and body in Japanese and English, the findings to act on, and what each measurement means. Empty when no report has been written yet.',
  })
  @ApiParam({ name: 'dev_eui', description: 'Device dev_eui' })
  @ApiQuery({
    name: 'type',
    required: false,
    enum: AI_REPORT_TYPES,
    description: 'Report type (default daily)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: `How many reports, 1-${AI_RECOMMENDATIONS_MAX_LIMIT} (default 1)`,
  })
  @ApiOkResponse({ type: AiRecommendationDto, isArray: true })
  @ApiBadRequestResponse({
    description: 'Invalid type or limit.',
    type: ErrorResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid bearer token.',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Device not found or not visible to the caller.',
    type: ErrorResponseDto,
  })
  @ApiInternalServerErrorResponse({
    description: 'Failed to read the reports.',
    type: ErrorResponseDto,
  })
  findForDevice(
    @CurrentUser() user: AuthenticatedUser,
    @Param('dev_eui') devEui: string,
    @Query('type') rawType?: string,
    @Query('limit') rawLimit?: string,
  ) {
    const normalizedDevEui = devEui?.trim();
    if (!normalizedDevEui) {
      throw new BadRequestException('dev_eui is required');
    }
    const type = rawType ?? 'daily';
    if (!(AI_REPORT_TYPES as readonly string[]).includes(type)) {
      throw new BadRequestException('type must be daily or weekly');
    }
    const limit = rawLimit === undefined ? 1 : Number(rawLimit);
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > AI_RECOMMENDATIONS_MAX_LIMIT
    ) {
      throw new BadRequestException(
        `limit must be an integer from 1 to ${AI_RECOMMENDATIONS_MAX_LIMIT}`,
      );
    }
    return this.aiRecommendations.findForDevice(
      user,
      normalizedDevEui,
      type as AiReportType,
      limit,
    );
  }
}
