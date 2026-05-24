import { Module } from '@nestjs/common';
import { SupabaseModule } from '../../supabase/supabase.module';
import { DevicesModule } from '../devices/devices.module';
import { LocationsModule } from '../locations/locations.module';
import { RulesNewController } from './rules-new.controller';
import { RulesNewService } from './rules-new.service';

@Module({
  imports: [SupabaseModule, DevicesModule, LocationsModule],
  controllers: [RulesNewController],
  providers: [RulesNewService],
})
export class RulesNewModule {}
