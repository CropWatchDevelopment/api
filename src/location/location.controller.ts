import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { LocationService } from './location.service';
import { CreateLocationDto } from './dto/create-location.dto';
import { ApiTags } from '@nestjs/swagger';
import { BaseController } from 'src/bases/base.controller';
import { Database } from 'database.types';

type LocationsRow = Database['public']['Tables']['cw_locations']['Row'];

@ApiTags('Locations')
@Controller('location')
export class LocationController extends BaseController<LocationsRow, CreateLocationDto>  {
  constructor(private readonly locationService: LocationService) {
    super(locationService);
  }

  // @Post()
  // create(@Body() createLocationDto: CreateLocationDto) {
  //   return this.locationService.create(createLocationDto);
  // }
}
