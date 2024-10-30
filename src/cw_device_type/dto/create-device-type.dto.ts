// src/cw_device_type/dto/create-device-type.dto.ts
import { IsNotEmpty, IsString } from 'class-validator';

export class CreateDeviceTypeDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsNotEmpty()
  @IsString()
  description: string;
}
