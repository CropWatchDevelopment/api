import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { SoilService } from './soil.service';
import type { CreateSoilDto } from './dto/create-soil.dto';
import type { UpdateSoilDto } from './dto/update-soil.dto';

@Controller('soil')
export class SoilController {
  constructor(private readonly soilService: SoilService) {}

  @Post()
  create(@Body() createSoilDto: CreateSoilDto) {
    return this.soilService.create(createSoilDto);
  }

  @Get()
  findAll() {
    return this.soilService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.soilService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateSoilDto: UpdateSoilDto) {
    return this.soilService.update(+id, updateSoilDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.soilService.remove(+id);
  }
}
