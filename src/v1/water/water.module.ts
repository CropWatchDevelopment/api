import { Module } from '@nestjs/common';
import { SupabaseModule } from '../../supabase/supabase.module';
import { CommonModule } from '../common/common.module';
import { WaterService } from './water.service';
import { WaterController } from './water.controller';
import { AuthzModule } from '../common/authz';

@Module({
  imports: [SupabaseModule, CommonModule, AuthzModule],
  controllers: [WaterController],
  providers: [WaterService],
})
export class WaterModule {}
