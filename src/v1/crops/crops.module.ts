import { Module } from '@nestjs/common';
import { SupabaseModule } from '../../supabase/supabase.module';
import { CropsController } from './crops.controller';
import { CropsService } from './crops.service';

@Module({
  imports: [SupabaseModule],
  controllers: [CropsController],
  providers: [CropsService],
})
export class CropsModule {}
