import { WebSocketGateway, SubscribeMessage, MessageBody } from '@nestjs/websockets';
import { RealtimeService } from './realtime.service';
import type { CreateRealtimeDto } from './dto/create-realtime.dto';
import type { UpdateRealtimeDto } from './dto/update-realtime.dto';

@WebSocketGateway()
export class RealtimeGateway {
  constructor(private readonly realtimeService: RealtimeService) {}

  @SubscribeMessage('findOneRealtime')
  findOne(@MessageBody() id: number) {
    return this.realtimeService.findOne(id);
  }
}
