import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { TrafficService } from './traffic.service';
import type { CreateTrafficDto } from './dto/create-traffic.dto';
import type { UpdateTrafficDto } from './dto/update-traffic.dto';

@Controller('traffic')
export class TrafficController {
  constructor(private readonly trafficService: TrafficService) {}

  @Post()
  create(@Body() createTrafficDto: CreateTrafficDto) {
    return this.trafficService.create(createTrafficDto);
  }

  @Get()
  findAll() {
    return this.trafficService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.trafficService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateTrafficDto: UpdateTrafficDto) {
    return this.trafficService.update(+id, updateTrafficDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.trafficService.remove(+id);
  }
}
