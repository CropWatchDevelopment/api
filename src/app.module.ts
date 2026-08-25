import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './v1/auth/auth.module';
import { ConfigModule } from '@nestjs/config';
import { AirModule } from './v1/air/air.module';
import { SoilModule } from './v1/soil/soil.module';
import { WaterModule } from './v1/water/water.module';
import { TrafficModule } from './v1/traffic/traffic.module';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { UserThrottlerGuard } from './v1/common/guards/user-throttler.guard';
import { DevicesModule } from './v1/devices/devices.module';
import { RulesModule } from './v1/rules/rules.module';
import { ReportsModule } from './v1/reports/reports.module';
import { LocationsModule } from './v1/locations/locations.module';
import { RelayModule } from './v1/relay/relay.module';
import { GatewayModule } from './v1/gateway/gateway.module';
import { DashboardModule } from './v1/dashboard/dashboard.module';
import { PaymentsModule } from './v1/payments/payments.module';
import { LineModule } from './v1/line/line.module';
import { PushModule } from './v1/push/push.module';
import { AccountRemovalModule } from './v1/account-removal/account-removal.module';
import { CropwatchMcpModule } from './v1/mcp/mcp.module';

@Module({
  imports: [
    AuthModule,
    ConfigModule.forRoot({ isGlobal: true }),
    AirModule,
    SoilModule,
    WaterModule,
    TrafficModule,
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'static'),
    }),
    // Limits are keyed per user (bearer token) by UserThrottlerGuard, not per
    // IP — the web app's SSR fans out many requests from a shared pool of Vercel
    // egress IPs, so an IP-keyed limit would throttle everyone at once.
    // NOTE: the default store is in-memory and per-instance; on Vercel the
    // effective limit is (limit x concurrent instances) and blocks don't
    // propagate. For hard, distributed enforcement use the Vercel WAF / a shared
    // store — tracked separately.
    ThrottlerModule.forRoot([
      {
        // Burst window: 120 requests / 10s per user. Covers the heaviest
        // legitimate client burst — a ~100-device dashboard foreground-resume
        // fans out ~100 requests within 15s. Offenders blocked for 30s.
        name: 'default',
        ttl: 10_000,
        limit: 120,
        blockDuration: 30_000,
      },
      {
        // Sustained window: 600 requests / minute per user, with headroom for
        // steady polling (relay 30s, per-device refresh). Blocked for 60s on
        // breach — no longer a 24h ban.
        name: 'long',
        ttl: 60_000,
        limit: 600,
        blockDuration: 60_000,
      },
    ]),
    DevicesModule,
    RulesModule,
    ReportsModule,
    LocationsModule,
    RelayModule,
    GatewayModule,
    DashboardModule,
    PaymentsModule,
    LineModule,
    PushModule,
    AccountRemovalModule,
    CropwatchMcpModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: UserThrottlerGuard }],
})
export class AppModule {}
