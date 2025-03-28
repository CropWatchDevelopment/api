import { Module } from '@nestjs/common';
import { PdfController } from './pdf.controller';
import { PdfService } from './pdf.service';
import { DataService } from 'src/data/data.service';
import { DataModule } from 'src/data/data.module';
import { CwDevicesModule } from 'src/cw_devices/cw_devices.module';
import { CwDeviceTypeModule } from 'src/cw_device_type/cw_device_type.module';
import { CwDeviceOwnersModule } from 'src/cw_device_owners/cw_device_owners.module';
import { AuthService } from 'src/auth/auth.service';
import { ReportsTemplatesModule } from 'src/reports_templates/reports_templates.module';
import { LocationModule } from 'src/location/location.module';
import { ProfilesModule } from 'src/profiles/profiles.module';

@Module({
  imports: [
    DataModule,
    LocationModule,
    ProfilesModule,
    CwDevicesModule,
    CwDeviceTypeModule,
    CwDeviceOwnersModule,
    ReportsTemplatesModule,
  ],
  controllers: [PdfController],
  providers: [
    PdfService,
    DataService,
    AuthService,
  ]
})
export class PdfModule { }
