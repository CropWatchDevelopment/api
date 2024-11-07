import {
  Get,
  Post,
  Body,
  Patch,
  Put,
  Delete,
  Param,
} from '@nestjs/common';
import { ApiCreateResponses, ApiDeleteResponses, ApiGetResponses, CommonResponses } from '../common/common-responses.decorator';
// import { ApiCommonAuth } from 'src/common/common-auth-decorators';
import { ApiCommonAuth } from '../common/common-auth-decorators';

export interface BaseServiceInterface<T, CreateDto, UpdateDto> {
  findAll: () => Promise<T[]>;
  create: (dto: CreateDto) => Promise<T>;
  partialUpdate: (id: number, dto: UpdateDto) => Promise<T>; // For PATCH
  fullUpdate: (id: number, dto: UpdateDto) => Promise<T>;
}

export class BaseController<T, CreateDto, UpdateDto> {
  constructor(private readonly service: BaseServiceInterface<T, CreateDto, UpdateDto>) { }

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

  @Put(':id')
  @ApiCommonAuth('Fully update a single item')
  @ApiCreateResponses()
  async FullUpdate(@Param('id') id: number, @Body() updateDto: UpdateDto): Promise<T> {
    return this.updateItem('full', id, updateDto);
  }

  @Patch(':id')
  @ApiCommonAuth('Partially update a single item')
  @ApiCreateResponses()
  async PartialUpdate(@Param('id') id: number, @Body() updateDto: UpdateDto): Promise<T> {
    return this.updateItem('partial', id, updateDto);
  }

  @Delete()
  @ApiCommonAuth('Delete a single item')
  @ApiDeleteResponses()
  async Delete(@Body() id: number): Promise<T> {
    return undefined;
  }

  private async updateItem(
    updateType: 'full' | 'partial',
    id: number,
    updateDto: UpdateDto
  ): Promise<T> {
    return updateType === 'full'
      ? this.service.fullUpdate(id, updateDto)
      : this.service.partialUpdate(id, updateDto);
  }
}
