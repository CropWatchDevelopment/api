import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { LocationService } from './location.service';
import { CreateLocationDto } from './dto/create-location.dto';
import { ApiTags } from '@nestjs/swagger';
import { BaseController } from '../bases/base.controller';
import { LocationsRow } from '../common/database-types';
import { UpdateLocationDto } from './dto/update-location.dto';

@ApiTags('Locations')
@Controller('location')
export class LocationController extends BaseController<LocationsRow, CreateLocationDto, UpdateLocationDto>  {
  constructor(locationService: LocationService) {
    super(locationService);
  }

  // @Post()
  // create(@Body() createLocationDto: CreateLocationDto) {
  //   return this.locationService.create(createLocationDto);
  // }
}
