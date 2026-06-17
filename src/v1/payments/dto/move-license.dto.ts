import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class MoveLicenseDto {
  @ApiProperty({
    description: 'dev_eui of the device to move this license to.',
  })
  @IsString()
  @IsNotEmpty()
  devEui: string;
}
