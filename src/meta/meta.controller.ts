import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { ApiBadRequestResponse, ApiCreatedResponse, ApiInternalServerErrorResponse, ApiNotFoundResponse, ApiOkResponse } from '@nestjs/swagger';
import { MetaService } from './meta.service';
import type { CreateMetaDto } from './dto/create-meta.dto';
import type { UpdateMetaDto } from './dto/update-meta.dto';
import { ErrorResponseDto } from '../common/dto/error-response.dto';

@Controller('meta')
export class MetaController {
  constructor(private readonly metaService: MetaService) {}

  @Post()
  @ApiCreatedResponse({
    description: 'Meta record created successfully.',
    schema: { type: 'string', example: 'This action adds a new meta' },
  })
  @ApiBadRequestResponse({
    description: 'Invalid meta payload.',
    type: ErrorResponseDto,
    example: { statusCode: 400, error: 'Bad Request', message: 'Validation failed' },
  })
  @ApiInternalServerErrorResponse({
    description: 'Failed to create meta record.',
    type: ErrorResponseDto,
    example: { statusCode: 500, error: 'Internal Server Error', message: 'Failed to create meta record' },
  })
  create(@Body() createMetaDto: CreateMetaDto) {
    return this.metaService.create(createMetaDto);
  }

  @Get()
  @ApiOkResponse({
    description: 'Meta records returned successfully.',
    schema: { type: 'string', example: 'This action returns all meta' },
  })
  @ApiInternalServerErrorResponse({
    description: 'Failed to fetch meta records.',
    type: ErrorResponseDto,
    example: { statusCode: 500, error: 'Internal Server Error', message: 'Failed to fetch meta records' },
  })
  findAll() {
    return this.metaService.findAll();
  }

  @Get(':id')
  @ApiOkResponse({
    description: 'Meta record returned successfully.',
    schema: { type: 'string', example: 'This action returns a #1 meta' },
  })
  @ApiBadRequestResponse({
    description: 'Invalid id.',
    type: ErrorResponseDto,
    example: { statusCode: 400, error: 'Bad Request', message: 'Invalid id' },
  })
  @ApiNotFoundResponse({
    description: 'Meta record not found.',
    type: ErrorResponseDto,
    example: { statusCode: 404, error: 'Not Found', message: 'Meta record not found' },
  })
  @ApiInternalServerErrorResponse({
    description: 'Failed to fetch meta record.',
    type: ErrorResponseDto,
    example: { statusCode: 500, error: 'Internal Server Error', message: 'Failed to fetch meta record' },
  })
  findOne(@Param('id') id: string) {
    return this.metaService.findOne(+id);
  }

  @Patch(':id')
  @ApiOkResponse({
    description: 'Meta record updated successfully.',
    schema: { type: 'string', example: 'This action updates a #1 meta' },
  })
  @ApiBadRequestResponse({
    description: 'Invalid id or payload.',
    type: ErrorResponseDto,
    example: { statusCode: 400, error: 'Bad Request', message: 'Validation failed' },
  })
  @ApiNotFoundResponse({
    description: 'Meta record not found.',
    type: ErrorResponseDto,
    example: { statusCode: 404, error: 'Not Found', message: 'Meta record not found' },
  })
  @ApiInternalServerErrorResponse({
    description: 'Failed to update meta record.',
    type: ErrorResponseDto,
    example: { statusCode: 500, error: 'Internal Server Error', message: 'Failed to update meta record' },
  })
  update(@Param('id') id: string, @Body() updateMetaDto: UpdateMetaDto) {
    return this.metaService.update(+id, updateMetaDto);
  }

  @Delete(':id')
  @ApiOkResponse({
    description: 'Meta record removed successfully.',
    schema: { type: 'string', example: 'This action removes a #1 meta' },
  })
  @ApiBadRequestResponse({
    description: 'Invalid id.',
    type: ErrorResponseDto,
    example: { statusCode: 400, error: 'Bad Request', message: 'Invalid id' },
  })
  @ApiNotFoundResponse({
    description: 'Meta record not found.',
    type: ErrorResponseDto,
    example: { statusCode: 404, error: 'Not Found', message: 'Meta record not found' },
  })
  @ApiInternalServerErrorResponse({
    description: 'Failed to remove meta record.',
    type: ErrorResponseDto,
    example: { statusCode: 500, error: 'Internal Server Error', message: 'Failed to remove meta record' },
  })
  remove(@Param('id') id: string) {
    return this.metaService.remove(+id);
  }
}
