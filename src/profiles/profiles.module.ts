import { Module } from '@nestjs/common';
import { ProfilesService } from './profiles.service';
import { ProfilesController } from './profiles.controller';
import { ProfileRepository } from '../repositories/profiles.repositories';
import { SupabaseModule } from '../supabase/supabase.module';

@Module({
  imports: [SupabaseModule],
  controllers: [ProfilesController],
  providers: [ProfilesService, ProfileRepository],
  exports: [ProfilesService]
})
export class ProfilesModule {}
