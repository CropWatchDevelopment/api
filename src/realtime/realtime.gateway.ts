import { WebSocketGateway, SubscribeMessage, MessageBody } from '@nestjs/websockets';
import { RealtimeService } from './realtime.service';
import type { CreateRealtimeDto } from './dto/create-realtime.dto';
import type { UpdateRealtimeDto } from './dto/update-realtime.dto';

@WebSocketGateway()
export class RealtimeGateway {
  constructor(private readonly realtimeService: RealtimeService) {}

  @SubscribeMessage('createRealtime')
  create(@MessageBody() createRealtimeDto: CreateRealtimeDto) {
    return this.realtimeService.create(createRealtimeDto);
  }

  @SubscribeMessage('findAllRealtime')
  findAll() {
    return this.realtimeService.findAll();
  }

  @SubscribeMessage('findOneRealtime')
  findOne(@MessageBody() id: number) {
    return this.realtimeService.findOne(id);
  }

  @SubscribeMessage('updateRealtime')
  update(@MessageBody() updateRealtimeDto: UpdateRealtimeDto) {
    return this.realtimeService.update(updateRealtimeDto.id, updateRealtimeDto);
  }

  @SubscribeMessage('removeRealtime')
  remove(@MessageBody() id: number) {
    return this.realtimeService.remove(id);
  }
}
