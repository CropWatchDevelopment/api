import { Module } from '@nestjs/common';
import { SupabaseModule } from '../../supabase/supabase.module';
import { CommonModule } from '../common/common.module';
import { SoilService } from './soil.service';
import { SoilController } from './soil.controller';
import { AuthzModule } from '../common/authz';

@Module({
  imports: [SupabaseModule, CommonModule, AuthzModule],
  controllers: [SoilController],
  providers: [SoilService],
})
export class SoilModule {}
