// src/cw_device_type/dto/create-device-type.dto.ts
import { IsNotEmpty, IsString } from 'class-validator';
import { BaseDeviceDto } from 'src/common/dto/base-dev-eui.dto';

export class CreateDeviceTypeDto extends BaseDeviceDto {
  @IsNotEmpty()
  @IsString()
  // name: string;

  @IsNotEmpty()
  @IsString()
  description: string;
}
