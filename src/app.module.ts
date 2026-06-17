import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './v1/auth/auth.module';
import { ConfigModule } from '@nestjs/config';
import { AirModule } from './v1/air/air.module';
import { SoilModule } from './v1/soil/soil.module';
import { WaterModule } from './v1/water/water.module';
import { PowerModule } from './v1/power/power.module';
import { TrafficModule } from './v1/traffic/traffic.module';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { DevicesModule } from './v1/devices/devices.module';
import { RulesNewModule } from './v1/rules-new/rules-new.module';
import { ReportsNewModule } from './v1/reports-new/reports-new.module';
import { LocationsModule } from './v1/locations/locations.module';
import { RelayModule } from './v1/relay/relay.module';
import { GatewayModule } from './v1/gateway/gateway.module';
import { DashboardModule } from './v1/dashboard/dashboard.module';
import { PaymentsModule } from './v1/payments/payments.module';
import { CropwatchMcpModule } from './v1/mcp/mcp.module';

@Module({
  imports: [
    AuthModule,
    ConfigModule.forRoot({ isGlobal: true }),
    AirModule,
    SoilModule,
    WaterModule,
    PowerModule,
    TrafficModule,
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'static'),
    }),
    ThrottlerModule.forRoot([
      {
        // app wide, if you send more than 10 requests in 1 minute, you get a 2-minute ban.
        name: 'default',
        ttl: 2000,
        limit: 2000,
        blockDuration: 6000,
      },
      {
        // If you send more than 100 requests in 1 minute, you get a 24-hour ban.
        name: 'long',
        ttl: 60000,
        limit: 2000,
        blockDuration: 86400000, // 24 hours
      },
    ]),
    DevicesModule,
    RulesNewModule,
    ReportsNewModule,
    LocationsModule,
    RelayModule,
    GatewayModule,
    DashboardModule,
    PaymentsModule,
    CropwatchMcpModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
