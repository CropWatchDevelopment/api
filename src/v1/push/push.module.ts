import { Module } from '@nestjs/common';
import { SupabaseModule } from '../../supabase/supabase.module';
import { PushController } from './push.controller';
import { PushService } from './push.service';

@Module({
  imports: [SupabaseModule],
  controllers: [PushController],
  providers: [PushService],
  exports: [PushService],
})
export class PushModule {}
