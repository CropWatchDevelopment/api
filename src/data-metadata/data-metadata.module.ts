import { Module } from '@nestjs/common';
import { DataMetadataController } from './data-metadata.controller';
import { DataMetadataService } from './data-metadata.service';
import { DataMetadataRepository } from 'src/repositories/cw_data_metadata.repository';
import { SupabaseModule } from 'src/supabase/supabase.module';
import { AuthModule } from 'src/auth/auth.module';

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
