import { Module } from '@nestjs/common';
import { LocationController } from './location.controller';
import { LocationService } from './location.service';
import { LocationRepository } from 'src/repositories/cw_location.repository';
import { SupabaseModule } from 'src/supabase/supabase.module';

@Module({
  imports: [SupabaseModule],
  controllers: [LocationController],
  providers: [
    LocationService,
    LocationRepository,
  ],
})
export class LocationModule {}
