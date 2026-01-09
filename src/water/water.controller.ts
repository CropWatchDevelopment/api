import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { WaterService } from './water.service';
import type { CreateWaterDto } from './dto/create-water.dto';
import type { UpdateWaterDto } from './dto/update-water.dto';

@Controller('water')
export class WaterController {
  constructor(private readonly waterService: WaterService) {}

  @Post()
  create(@Body() createWaterDto: CreateWaterDto) {
    return this.waterService.create(createWaterDto);
  }

  @Get()
  findAll() {
    return this.waterService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.waterService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateWaterDto: UpdateWaterDto) {
    return this.waterService.update(+id, updateWaterDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.waterService.remove(+id);
  }
}
