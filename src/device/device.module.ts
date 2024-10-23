import { Module } from '@nestjs/common';
import { DeviceService } from './device.service';
import { DeviceController } from './device.controller';
import { AuthService } from 'src/auth/auth.service';

@Module({
  controllers: [DeviceController],
  providers: [DeviceService, AuthService],
})
export class DeviceModule {}
