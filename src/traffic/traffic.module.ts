import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { CommonModule } from '../common/common.module';
import { TrafficService } from './traffic.service';
import { TrafficController } from './traffic.controller';

@Module({
  imports: [SupabaseModule, CommonModule],
  controllers: [TrafficController],
  providers: [TrafficService],
})
export class TrafficModule {}
