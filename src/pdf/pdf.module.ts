import { Module } from '@nestjs/common';
import { PdfService } from './pdf.service';
import { PdfController } from './pdf.controller';
import { DataService } from '../data/data.service';
import { DataModule } from '../data/data.module';
import { CwDevicesModule } from '../cw_devices/cw_devices.module';
import { CwDeviceTypeModule } from '../cw_device_type/cw_device_type.module';
import { CwDeviceOwnersModule } from '../cw_device_owners/cw_device_owners.module';
import { LocationModule } from '../location/location.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { ReportsTemplatesModule } from '../reports_templates/reports_templates.module';
import { AuthService } from '../auth/auth.service';

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
