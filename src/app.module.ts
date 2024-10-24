import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from '@nestjs/config';
import { DeviceModule } from './device/device.module';
import { DataModule } from './data/data.module';
import { LocationModule } from './location/location.module';
import { SupabaseService } from './supabase/supabase.service';
import { SupabaseModule } from './supabase/supabase.module';
import { ProfilesModule } from './profiles/profiles.module';
import { CwDeviceOwnersModule } from './cw_device_owners/cw_device_owners.module';
import { CwDeviceLocationsModule } from './cw_device_locations/cw_device_locations.module';

@Module({
  imports: [
    AuthModule,
    ConfigModule.forRoot({
      envFilePath: ['.env.development.local', '.env.development', '.env'],
      isGlobal: true,
    }),
    DeviceModule,
    DataModule,
    LocationModule,
    SupabaseModule,
    ProfilesModule,
    CwDeviceOwnersModule,
    CwDeviceLocationsModule,
  ],
  controllers: [AppController],
  providers: [AppService, SupabaseService],
})
export class AppModule { }
