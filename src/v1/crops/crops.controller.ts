import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
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
  ApiSecurity,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt.auth.guard';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { CropsService } from './crops.service';
import { CropTypeDetailDto, CropTypeDto } from './dto/crop-type.dto';

@Controller({ path: 'crops', version: '1' })
@ApiBearerAuth('bearerAuth')
@ApiSecurity('apiKey')
@UseGuards(JwtAuthGuard)
@ApiUnauthorizedResponse({
  description: 'Missing or invalid bearer token.',
  type: ErrorResponseDto,
})
@ApiInternalServerErrorResponse({
  description: 'Failed to read the crop types.',
  type: ErrorResponseDto,
})
export class CropsController {
  constructor(private readonly cropsService: CropsService) {}

  @Get()
  @ApiOperation({
    summary: 'List the crop types',
    description:
      'The crops a soil sensor can be set to, in display order (retired crops are left out).',
  })
  @ApiOkResponse({ type: CropTypeDto, isArray: true })
  findAll() {
    return this.cropsService.findAll();
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a crop type with its growing targets',
    description:
      'Optimal band and stress limits per metric and period of the day (day, night or all), with the basis and sources of each value.',
  })
  @ApiParam({ name: 'id', description: 'Crop type id' })
  @ApiOkResponse({ type: CropTypeDetailDto })
  @ApiBadRequestResponse({
    description: 'The id is not an integer.',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Crop type not found.',
    type: ErrorResponseDto,
  })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.cropsService.findOne(id);
  }
}
