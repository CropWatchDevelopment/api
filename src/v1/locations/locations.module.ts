import { Module } from '@nestjs/common';
import { LocationsService } from './locations.service';
import { LocationsController } from './locations.controller';
import { SupabaseModule } from '../../supabase/supabase.module';
import { AuthzModule } from '../common/authz';

@Module({
  imports: [SupabaseModule, AuthzModule],
  controllers: [LocationsController],
  providers: [LocationsService],
  exports: [LocationsService],
})
export class LocationsModule {}
