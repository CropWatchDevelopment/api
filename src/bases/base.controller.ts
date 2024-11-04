import {
  Get,
  Post,
  Body,
  Patch,
  Put,
  Delete,
} from '@nestjs/common';
import { ApiCreateResponses, ApiDeleteResponses, ApiGetResponses, CommonResponses } from 'src/common/common-responses.decorator';
import { ApiCommonAuth } from 'src/common/common-auth-decorators';

export interface BaseServiceInterface<T, CreateDto> {
  findAll: () => Promise<T[]>;
  create: (dto: CreateDto) => Promise<T>;
}

export class BaseController<T, CreateDto> {
  constructor(private readonly service: BaseServiceInterface<T, CreateDto>) { }

  @Get()
  @ApiCommonAuth('Get all items')
  @CommonResponses()
  @ApiGetResponses()
  async findAll(): Promise<T[]> {
    return this.service.findAll();
  }

  @Post()
  @ApiCommonAuth('Create a new item')
  @ApiCreateResponses()
  async create(@Body() createDto: CreateDto): Promise<T> {
    return this.service.create(createDto);
  }

  @Patch()
  @ApiCommonAuth('Update a single item')
  @ApiCreateResponses()
  async PartialUpdate(@Body() createDto: CreateDto): Promise<T> {
    return this.service.create(createDto);
  }

  @Put()
  @ApiCommonAuth('Update a single item')
  @ApiCreateResponses()
  async FullUpdate(@Body() createDto: CreateDto): Promise<T> {
    return this.service.create(createDto);
  }

  @Delete()
  @ApiCommonAuth('Delete a single item')
  @ApiDeleteResponses()
  async Delete(@Body() createDto: CreateDto): Promise<T> {
    throw new Error('Method not implemented.');
  }
}
