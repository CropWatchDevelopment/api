import { Injectable } from '@nestjs/common';
import { CreateSoilDto } from './dto/create-soil.dto';
import { UpdateSoilDto } from './dto/update-soil.dto';

@Injectable()
export class SoilService {
  create(createSoilDto: CreateSoilDto) {
    return 'This action adds a new soil';
  }

  findAll() {
    return `This action returns all soil`;
  }

  findOne(id: number) {
    return `This action returns a #${id} soil`;
  }

  update(id: number, updateSoilDto: UpdateSoilDto) {
    return `This action updates a #${id} soil`;
  }

  remove(id: number) {
    return `This action removes a #${id} soil`;
  }
}
