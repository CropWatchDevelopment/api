import { Injectable } from '@nestjs/common';
import { CreateRealtimeDto } from './dto/create-realtime.dto';
import { UpdateRealtimeDto } from './dto/update-realtime.dto';

@Injectable()
export class RealtimeService {

  findOne(id: number) {
    return `This action returns a #${id} realtime`;
  }

}
