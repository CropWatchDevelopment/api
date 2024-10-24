// src/devices/device.module.ts
import { Module } from '@nestjs/common';
import { DeviceService } from './device.service';
import { DeviceRepository } from './repositories/device.repository'; // Import your repository
import { SupabaseModule } from 'src/supabase/supabase.module';
import { DeviceController } from './device.controller';

@Module({
  imports: [SupabaseModule], // Import SupabaseModule if DeviceRepository depends on it
  controllers: [DeviceController], // Add your controller here
  providers: [
    DeviceService,
    DeviceRepository, // Provide your repository here
  ],
  exports: [DeviceService], // Export DeviceService if needed
})
export class DeviceModule {}