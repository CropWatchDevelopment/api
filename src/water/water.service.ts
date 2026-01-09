import { Injectable } from '@nestjs/common';
import { CreateWaterDto } from './dto/create-water.dto';
import { UpdateWaterDto } from './dto/update-water.dto';

@Injectable()
export class WaterService {
  create(createWaterDto: CreateWaterDto) {
    return 'This action adds a new water';
  }

  findAll() {
    return `This action returns all water`;
  }

  findOne(id: number) {
    return `This action returns a #${id} water`;
  }

  update(id: number, updateWaterDto: UpdateWaterDto) {
    return `This action updates a #${id} water`;
  }

  remove(id: number) {
    return `This action removes a #${id} water`;
  }
}
