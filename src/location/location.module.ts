import { Module } from '@nestjs/common';
import { LocationController } from './location.controller';
import { LocationService } from './location.service';
import { LocationRepository } from 'src/repositories/cw_location.repository';
import { SupabaseModule } from 'src/supabase/supabase.module';
import { BaseRepository } from 'src/repositories/base.repository';
import { AuthModule } from 'src/auth/auth.module';

@Module({
  imports: [SupabaseModule, AuthModule, BaseRepository],
  providers: [LocationService, LocationRepository],
  controllers: [LocationController],
  exports: [LocationService],
})
export class LocationModule {}
