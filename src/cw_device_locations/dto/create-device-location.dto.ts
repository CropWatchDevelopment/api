// src/cw_device_locations/dto/create-device-location.dto.ts
import { IsNotEmpty, IsNumber, IsString } from 'class-validator';

export class CreateDeviceLocationDto {
  @IsNotEmpty()
  @IsNumber()
  device_id: number;

  @IsNotEmpty()
  @IsNumber()
  location_id: number;
}
