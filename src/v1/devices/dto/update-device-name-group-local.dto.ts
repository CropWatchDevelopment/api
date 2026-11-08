import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdateDeviceNameGroupLocalDto {
  @ApiProperty({ example: 'New Device Name', type: String, required: true })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @ApiPropertyOptional({
    example: 'New Device Group',
    type: String,
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  group?: string | null;

  @ApiProperty({ example: 54, type: Number, required: true })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  location_id: number;

  @ApiPropertyOptional({
    example: 'eui-device-name',
    type: String,
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  tti_name?: string | null;

  @ApiPropertyOptional({
    example: 3,
    type: Number,
    nullable: true,
    description:
      'Crop the soil sensor monitors (an id from GET /v1/crops); null clears it. Soil sensors only. Omit it to leave the crop unchanged.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  crop_type_id?: number | null;
}
