import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from '@nestjs/config';
import { AirModule } from './air/air.module';
import { SoilModule } from './soil/soil.module';
import { WaterModule } from './water/water.module';
import { PowerModule } from './power/power.module';
import { TrafficModule } from './traffic/traffic.module';
import { RealtimeModule } from './realtime/realtime.module';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { DevicesModule } from './devices/devices.module';

@Module({
  imports: [
    AuthModule,
    ConfigModule.forRoot({ isGlobal: true }),
    AirModule,
    SoilModule,
    WaterModule,
    PowerModule,
    TrafficModule,
    RealtimeModule,
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'static'),
    }),
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 2000,
        limit: 2,
        blockDuration: 5000,
      }
    ]),
    DevicesModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule { }
