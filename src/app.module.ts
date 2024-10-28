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
import { CwDevicesModule } from './cw_devices/cw_devices.module';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { CacheInterceptor, CacheModule } from '@nestjs/cache-manager';

@Module({
  imports: [
    AuthModule,
    ConfigModule.forRoot({
      envFilePath: ['.env.development.local', '.env.development', '.env'],
      isGlobal: true,
    }),
    ThrottlerModule.forRoot([{
      ttl: 60000,
      limit: 3,
    }]),
    CacheModule.register({
      ttl: 60 * 10, // seconds
      max: 1000, // maximum number of items in cache
      isGlobal: true,
    }),
    DeviceModule,
    DataModule,
    LocationModule,
    SupabaseModule,
    ProfilesModule,
    CwDeviceOwnersModule,
    CwDeviceLocationsModule,
    CwDevicesModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    SupabaseService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: CacheInterceptor,
    },
  ],
})
export class AppModule {}
