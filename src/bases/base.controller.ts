import {
  Get,
  Post,
  Body,
  Patch,
  Put,
  Delete,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity } from '@nestjs/swagger';
import { ApiCreateResponses, ApiDeleteResponses, ApiGetResponses } from './base.decorator';

export interface BaseServiceInterface<T, CreateDto> {
  findAll: () => Promise<T[]>;
  create: (dto: CreateDto) => Promise<T>;
}

export class BaseController<T, CreateDto> {
  constructor(private readonly service: BaseServiceInterface<T, CreateDto>) {}

  @ApiSecurity('x-api-key', ['x-api-key'])
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Get all items' })
  @ApiGetResponses()
  @Get()
  async findAll(): Promise<T[]> {
    return this.service.findAll();
  }

  @ApiSecurity('x-api-key', ['x-api-key'])
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Create a new item' })
  @ApiCreateResponses()
  @Post()
  async create(@Body() createDto: CreateDto): Promise<T> {
    return this.service.create(createDto);
  }

  @ApiSecurity('x-api-key', ['x-api-key'])
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Update a single item' })
  @ApiCreateResponses()
  @Patch()
  async PartialUpdate(@Body() createDto: CreateDto): Promise<T> {
    return this.service.create(createDto);
  }

  @ApiSecurity('x-api-key', ['x-api-key'])
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Update a single item' })
  @ApiCreateResponses()
  @Put()
  async FullUpdate(@Body() createDto: CreateDto): Promise<T> {
    return this.service.create(createDto);
  }

  @ApiSecurity('x-api-key', ['x-api-key'])
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Delete a single item' })
  @ApiDeleteResponses()
  @Delete()
  async Delete(@Body() createDto: CreateDto): Promise<T> {
    throw new Error('Method not implemented.');
  }
}
