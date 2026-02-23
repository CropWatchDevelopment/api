import { Module } from '@nestjs/common';
import { SupabaseModule } from '../../supabase/supabase.module';
import { CommonModule } from '../common/common.module';
import { SoilService } from './soil.service';
import { SoilController } from './soil.controller';

@Module({
  imports: [SupabaseModule, CommonModule],
  controllers: [SoilController],
  providers: [SoilService],
})
export class SoilModule {}
