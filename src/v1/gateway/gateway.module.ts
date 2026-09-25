import { Module } from '@nestjs/common';
import { GatewayService } from './gateway.service';
import { GatewayController } from './gateway.controller';
import { SupabaseModule } from '../../supabase/supabase.module';
import { AuthzModule } from '../common/authz';

@Module({
  imports: [SupabaseModule, AuthzModule],
  controllers: [GatewayController],
  providers: [GatewayService],
})
export class GatewayModule {}
