import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { AirService } from './air.service';
import { AirController } from './air.controller';

@Module({
  imports: [SupabaseModule],
  controllers: [AirController],
  providers: [AirService],
})
export class AirModule {}
