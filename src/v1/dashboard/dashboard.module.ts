import { Module } from '@nestjs/common';
import { SupabaseModule } from '../../supabase/supabase.module';
import { CommonModule } from '../common/common.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { AuthzModule } from '../common/authz';

@Module({
  imports: [SupabaseModule, CommonModule, AuthzModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
