import { Injectable } from '@nestjs/common';
import { CreateTrafficDto } from './dto/create-traffic.dto';
import { UpdateTrafficDto } from './dto/update-traffic.dto';

@Injectable()
export class TrafficService {
  create(createTrafficDto: CreateTrafficDto) {
    return 'This action adds a new traffic';
  }

  findAll() {
    return `This action returns all traffic`;
  }

  findOne(id: number) {
    return `This action returns a #${id} traffic`;
  }

  update(id: number, updateTrafficDto: UpdateTrafficDto) {
    return `This action updates a #${id} traffic`;
  }

  remove(id: number) {
    return `This action removes a #${id} traffic`;
  }
}
