import { Module } from '@nestjs/common';
import { LocationController } from './location.controller';
import { LocationService } from './location.service';
import { LocationRepository } from 'src/repositories/cw_location.repository';
import { SupabaseModule } from 'src/supabase/supabase.module';
import { BaseRepository } from 'src/repositories/base.repository';

@Module({
  imports: [SupabaseModule],
  controllers: [LocationController],
  providers: [
    LocationService,
    LocationRepository,
    BaseRepository,
  ],
})
export class LocationModule {}
