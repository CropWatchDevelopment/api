import { Module } from '@nestjs/common';
import { SupabaseModule } from '../../supabase/supabase.module';
import { AuthzModule } from '../common/authz';
import { GatewayModule } from '../gateway/gateway.module';
import { OverviewController } from './overview.controller';
import { OverviewService } from './overview.service';

@Module({
  imports: [SupabaseModule, AuthzModule, GatewayModule],
  controllers: [OverviewController],
  providers: [OverviewService],
})
export class OverviewModule {}
