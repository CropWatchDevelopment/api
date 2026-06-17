import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class AssignLicenseDto {
  @ApiProperty({
    description: 'dev_eui of the device to assign this license to.',
  })
  @IsString()
  @IsNotEmpty()
  devEui: string;
}
