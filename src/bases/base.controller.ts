import { Get, Post, Body, UseInterceptors } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';

export interface BaseServiceInterface<T, CreateDto> {
  findAll: () => Promise<T[]>;
  create: (dto: CreateDto) => Promise<T>;
}

export class BaseController<T, CreateDto> {
  constructor(private readonly service: BaseServiceInterface<T, CreateDto>) {}

  @ApiResponse({ status: 200, description: 'OK' })
  @ApiResponse({ status: 400, description: 'Bad Request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 402, description: 'Payment Required' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiOperation({ summary: 'Get all items' })
  @Get()
  async findAll(): Promise<T[]> {
    return this.service.findAll();
  }

  @ApiResponse({ status: 201, description: 'Content Created' })
  @ApiResponse({ status: 400, description: 'Bad Request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 402, description: 'Payment Required' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiOperation({ summary: 'Create a new item' })
  @Post()
  async create(@Body() createDto: CreateDto): Promise<T> {
    return this.service.create(createDto);
  }
}