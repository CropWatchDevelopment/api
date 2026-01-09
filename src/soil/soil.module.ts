import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { SoilService } from './soil.service';
import { SoilController } from './soil.controller';

@Module({
  imports: [SupabaseModule],
  controllers: [SoilController],
  providers: [SoilService],
})
export class SoilModule {}
