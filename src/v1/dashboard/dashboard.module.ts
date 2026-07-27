import { Module } from '@nestjs/common';
import { SupabaseModule } from '../../supabase/supabase.module';
import { CommonModule } from '../common/common.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [SupabaseModule, CommonModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
