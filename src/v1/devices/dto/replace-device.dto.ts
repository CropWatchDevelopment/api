import { ApiProperty, PartialType } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class ReplaceDeviceDto {
    @ApiProperty({ description: 'LoRaWAN dev_eui for replacement device', example: 'A1B2C3D4E5F60708' })
    @IsString()
    @IsNotEmpty()
    dev_eui: string;
}