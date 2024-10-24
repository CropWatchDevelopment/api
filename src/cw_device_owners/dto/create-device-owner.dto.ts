// src/cw_device_owners/dto/create-device-owner.dto.ts
import { IsNotEmpty, IsNumber, IsString } from 'class-validator';

export class CreateDeviceOwnerDto {
  @IsNotEmpty()
  @IsString()
  dev_eui: string;

  @IsNotEmpty()
  @IsNumber()
  owner_id: number;

  @IsNotEmpty()
  @IsNumber()
  permission_level: number;

  @IsNotEmpty()
  @IsString()
  user_id: string;
}
