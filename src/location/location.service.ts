import { Injectable } from '@nestjs/common';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { BaseService } from 'src/bases/base.service';
import { BaseRepository } from 'src/repositories/base.repository';
import { LocationRow } from 'src/common/database-types';
import { LocationRepository } from 'src/repositories/cw_location.repository';

@Injectable()
export class LocationService extends BaseService<LocationRow, CreateLocationDto, UpdateLocationDto> {
  // constructor(repository: BaseRepository<LocationRow>) {
  constructor(repository: LocationRepository) {
    super(repository);
  }
}
