// src/app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { DataModule } from './data/data.module';
import { LocationModule } from './location/location.module';
import { SupabaseModule } from './supabase/supabase.module';
import { ProfilesModule } from './profiles/profiles.module';
import { CwDeviceOwnersModule } from './cw_device_owners/cw_device_owners.module';
import { CwDevicesModule } from './cw_devices/cw_devices.module';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { AuthService } from './auth/auth.service';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { CacheModule } from '@nestjs/cache-manager';
import { RelayModule } from './relay/relay.module';
import { GeolocationModule } from './geolocation/geolocation.module';
import { AppController } from './app.controller';
import { HealthModule } from './health/health.module';
import { PdfModule } from './pdf/pdf.module';
import { ReportsTemplatesModule } from './reports_templates/reports_templates.module';

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
    DataModule,
    LocationModule,
    SupabaseModule,
    ProfilesModule,
    CwDeviceOwnersModule,
    CwDevicesModule,
    RelayModule,
    GeolocationModule,
    HealthModule,
    PdfModule,
    ReportsTemplatesModule,
  ],
  controllers: [AppController],
  providers: [
    AuthService,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,  // Register JwtAuthGuard as a global guard
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard
    },
  ],
})
export class AppModule {}
