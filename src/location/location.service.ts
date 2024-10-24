import { Injectable } from '@nestjs/common';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { LocationRepository } from 'src/repositories/cw_location.repository';

@Injectable()
export class LocationService {
  constructor(private readonly locationRepository: LocationRepository) {}

  create(createLocationDto: CreateLocationDto) {
    return this.locationRepository.create(createLocationDto);
  }

  findAll() {
    return this.locationRepository.findAll();
  }

  findOne(id: number) {
    return this.locationRepository.findById(id);
  }

  update(id: number, updateLocationDto: UpdateLocationDto) {
    return `This action updates a #${id} location`;
  }

  remove(id: number) {
    return `This action removes a #${id} location`;
  }
}
