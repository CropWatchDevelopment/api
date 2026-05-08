import { Module } from '@nestjs/common';
import { SupabaseModule } from '../../supabase/supabase.module';
import { RulesNewController } from './rules-new.controller';
import { RulesNewService } from './rules-new.service';

@Module({
  imports: [SupabaseModule],
  controllers: [RulesNewController],
  providers: [RulesNewService],
})
export class RulesNewModule {}
