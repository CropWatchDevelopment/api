import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
} from '@nestjs/swagger';
import { PowerService } from './power.service';
import type { CreatePowerDto } from './dto/create-power.dto';
import type { UpdatePowerDto } from './dto/update-power.dto';
import { ErrorResponseDto } from '../common/dto/error-response.dto';

@Controller('power')
export class PowerController {
  constructor(private readonly powerService: PowerService) {}

  // @Post()
  // @ApiCreatedResponse({
  //   description: 'Power record created successfully.',
  //   schema: { type: 'string', example: 'This action adds a new power' },
  // })
  // @ApiBadRequestResponse({
  //   description: 'Invalid power payload.',
  //   type: ErrorResponseDto,
  //   example: { statusCode: 400, error: 'Bad Request', message: 'Validation failed' },
  // })
  // @ApiInternalServerErrorResponse({
  //   description: 'Failed to create power record.',
  //   type: ErrorResponseDto,
  //   example: { statusCode: 500, error: 'Internal Server Error', message: 'Failed to create power record' },
  // })
  // create(@Body() createPowerDto: CreatePowerDto) {
  //   return this.powerService.create(createPowerDto);
  // }

  @Get(':id')
  @ApiOkResponse({
    description: 'Power record returned successfully.',
    schema: { type: 'string', example: 'This action returns a #1 power' },
  })
  @ApiBadRequestResponse({
    description: 'Invalid id.',
    type: ErrorResponseDto,
    example: { statusCode: 400, error: 'Bad Request', message: 'Invalid id' },
  })
  @ApiNotFoundResponse({
    description: 'Power record not found.',
    type: ErrorResponseDto,
    example: {
      statusCode: 404,
      error: 'Not Found',
      message: 'Power record not found',
    },
  })
  @ApiInternalServerErrorResponse({
    description: 'Failed to fetch power record.',
    type: ErrorResponseDto,
    example: {
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'Failed to fetch power record',
    },
  })
  findOne(@Param('id') id: string) {
    return this.powerService.findOne(+id);
  }
}
