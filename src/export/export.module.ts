import { Module } from '@nestjs/common';
import { ExportController } from './export.controller';
import { ExportService } from './export.service';
import { AuthService } from 'src/auth/auth.service';
import { DataService } from 'src/data/data.service';
import { CwDevicesModule } from 'src/cw_devices/cw_devices.module';
import { ProfilesModule } from 'src/profiles/profiles.module';
import { CwDeviceTypeModule } from 'src/cw_device_type/cw_device_type.module';
import { DataModule } from 'src/data/data.module';
import { CwDeviceOwnersModule } from 'src/cw_device_owners/cw_device_owners.module';
import { DataMetadataService } from 'src/data-metadata/data-metadata.service';
import { DataMetadataModule } from 'src/data-metadata/data-metadata.module';

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
