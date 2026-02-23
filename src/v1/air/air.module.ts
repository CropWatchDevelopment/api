import { Module } from '@nestjs/common';
import { SupabaseModule } from '../../supabase/supabase.module';
import { CommonModule } from '../common/common.module';
import { AirService } from './air.service';
import { AirController } from './air.controller';

@Module({
  imports: [SupabaseModule, CommonModule],
  controllers: [AirController],
  providers: [AirService],
})
export class AirModule {}
