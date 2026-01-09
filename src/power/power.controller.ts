import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { PowerService } from './power.service';
import type { CreatePowerDto } from './dto/create-power.dto';
import type { UpdatePowerDto } from './dto/update-power.dto';

@Controller('power')
export class PowerController {
  constructor(private readonly powerService: PowerService) {}

  @Post()
  create(@Body() createPowerDto: CreatePowerDto) {
    return this.powerService.create(createPowerDto);
  }

  @Get()
  findAll() {
    return this.powerService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.powerService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updatePowerDto: UpdatePowerDto) {
    return this.powerService.update(+id, updatePowerDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.powerService.remove(+id);
  }
}
