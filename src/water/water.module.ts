import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { CommonModule } from '../common/common.module';
import { WaterService } from './water.service';
import { WaterController } from './water.controller';

@Module({
  imports: [SupabaseModule, CommonModule],
  controllers: [WaterController],
  providers: [WaterService],
})
export class WaterModule {}
