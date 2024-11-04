import { Injectable } from '@nestjs/common';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { BaseService } from 'src/bases/base.service';
import { BaseRepository } from 'src/repositories/base.repository';
import { LocationRow } from 'src/common/database-types';

@Injectable()
export class LocationService extends BaseService<LocationRow, CreateLocationDto, UpdateLocationDto> {
  constructor(repository: BaseRepository<LocationRow>) {
    super(repository);
  }

}
