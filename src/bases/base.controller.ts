import { Get, Post, Body, UseInterceptors } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';

export interface BaseServiceInterface<T, CreateDto> {
  findAll: () => Promise<T[]>;
  create: (dto: CreateDto) => Promise<T>;
}

export class BaseController<T, CreateDto> {
  constructor(private readonly service: BaseServiceInterface<T, CreateDto>) {}

  @ApiOperation({ summary: 'Get all items' })
  @Get()
  async findAll(): Promise<T[]> {
    return this.service.findAll();
  }

  @ApiOperation({ summary: 'Create a new item' })
  @Post()
  async create(@Body() createDto: CreateDto): Promise<T> {
    return this.service.create(createDto);
  }
}