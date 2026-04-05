import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SupabaseModule } from '../../supabase/supabase.module';
import { RelayController } from './relay.controller';
import { RelayCommandLockService } from './relay-command-lock.service';
import { RelayService } from './relay.service';

@Module({
  imports: [ConfigModule, SupabaseModule],
  controllers: [RelayController],
  providers: [RelayCommandLockService, RelayService, ConfigService],
})
export class RelayModule { }
