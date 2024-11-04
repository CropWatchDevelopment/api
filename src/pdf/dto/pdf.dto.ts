// User Auth DTO
import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class PdfDTO {
  @ApiProperty({ description: 'Dev Eui of the device to generate a report for.' })
  @IsString()
  devEui: string;
}