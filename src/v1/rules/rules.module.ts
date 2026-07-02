import { Module } from '@nestjs/common';
import { SupabaseModule } from '../../supabase/supabase.module';
import { DevicesModule } from '../devices/devices.module';
import { LocationsModule } from '../locations/locations.module';
import { RulesController } from './rules.controller';
import { RulesService } from './rules.service';

@Module({
  imports: [SupabaseModule, DevicesModule, LocationsModule],
  controllers: [RulesController],
  providers: [RulesService],
})
export class RulesModule {}
