import { Module } from '@nestjs/common';
import { DataMetadataService } from './data-metadata.service';
import { DataMetadataController } from './data-metadata.controller';
import { DataMetadataRepository } from '../repositories/cw_data_metadata.repository';
import { SupabaseModule } from '../supabase/supabase.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [SupabaseModule, AuthModule],
  controllers: [DataMetadataController],
  providers: [
    DataMetadataService,
    DataMetadataRepository,
  ],
  exports: [DataMetadataService, DataMetadataRepository],
})
export class DataMetadataModule {}
