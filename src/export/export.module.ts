import { Module } from '@nestjs/common';
import { ExportService } from './export.service';
import { ExportController } from './export.controller';
import { AuthService } from '../auth/auth.service';
import { DataService } from '../data/data.service';
import { CwDevicesModule } from '../cw_devices/cw_devices.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { CwDeviceTypeModule } from '../cw_device_type/cw_device_type.module';
import { DataModule } from '../data/data.module';
import { CwDeviceOwnersModule } from '../cw_device_owners/cw_device_owners.module';
import { DataMetadataService } from '../data-metadata/data-metadata.service';
import { DataMetadataModule } from '../data-metadata/data-metadata.module';

@Module({
  imports: [
    CwDevicesModule,
    CwDeviceTypeModule,
    ProfilesModule,
    DataModule,
    ProfilesModule,
    CwDevicesModule,
    CwDeviceTypeModule,
    CwDeviceOwnersModule,
    DataMetadataModule,
  ],
  controllers: [ExportController],
  providers: [
    ExportService,
    AuthService,
    DataService,
    DataMetadataService,
  ]
})
export class ExportModule { }
