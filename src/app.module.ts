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
      rootPath: join(__dirname, '..', 'static'),
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
