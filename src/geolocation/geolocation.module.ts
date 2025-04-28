import { Module } from '@nestjs/common';
import { GeolocationController } from './geolocation.controller';
import { GeolocationService } from './geolocation.service';
import { AuthService } from '../auth/auth.service';

@Module({
  controllers: [GeolocationController],
  providers: [GeolocationService, AuthService]
})
export class GeolocationModule { }
