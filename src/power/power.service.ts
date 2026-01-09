import { Injectable } from '@nestjs/common';
import { CreatePowerDto } from './dto/create-power.dto';
import { UpdatePowerDto } from './dto/update-power.dto';

@Injectable()
export class PowerService {
  create(createPowerDto: CreatePowerDto) {
    return 'This action adds a new power';
  }

  findAll() {
    return `This action returns all power`;
  }

  findOne(id: number) {
    return `This action returns a #${id} power`;
  }

  update(id: number, updatePowerDto: UpdatePowerDto) {
    return `This action updates a #${id} power`;
  }

  remove(id: number) {
    return `This action removes a #${id} power`;
  }
}
