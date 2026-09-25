import { Module } from '@nestjs/common';
import { SupabaseModule } from '../../supabase/supabase.module';
import { PushController } from './push.controller';
import { PushService } from './push.service';
import { AuthzModule } from '../common/authz';

@Module({
  imports: [SupabaseModule, AuthzModule],
  controllers: [PushController],
  providers: [PushService],
  exports: [PushService],
})
export class PushModule {}
