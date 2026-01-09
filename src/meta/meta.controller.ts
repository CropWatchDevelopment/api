import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { MetaService } from './meta.service';
import type { CreateMetaDto } from './dto/create-meta.dto';
import type { UpdateMetaDto } from './dto/update-meta.dto';

@Controller('meta')
export class MetaController {
  constructor(private readonly metaService: MetaService) {}

  @Post()
  create(@Body() createMetaDto: CreateMetaDto) {
    return this.metaService.create(createMetaDto);
  }

  @Get()
  findAll() {
    return this.metaService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.metaService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateMetaDto: UpdateMetaDto) {
    return this.metaService.update(+id, updateMetaDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.metaService.remove(+id);
  }
}
