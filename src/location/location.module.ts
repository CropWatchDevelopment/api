import { Module } from '@nestjs/common';
import { LocationController } from './location.controller';
import { LocationService } from './location.service';
import { LocationRepository } from '../repositories/cw_location.repository';
import { SupabaseModule } from '../supabase/supabase.module';
import { BaseRepository } from '../repositories/base.repository';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [SupabaseModule, AuthModule, BaseRepository],
  providers: [LocationService, LocationRepository],
  controllers: [LocationController],
  exports: [LocationService],
})
export class LocationModule {}
