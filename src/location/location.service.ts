import { Injectable } from '@nestjs/common';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { BaseService } from '../bases/base.service';
import { BaseRepository } from '../repositories/base.repository';
import { LocationRow } from '../common/database-types';
import { LocationRepository } from '../repositories/cw_location.repository';

@Injectable()
export class LocationService extends BaseService<LocationRow, CreateLocationDto, UpdateLocationDto> {
  // constructor(repository: BaseRepository<LocationRow>) {
  constructor(repository: LocationRepository) {
    super(repository);
  }
}
