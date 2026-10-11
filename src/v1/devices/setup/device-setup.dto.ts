import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

// Separators (space, colon, dash) are accepted and stripped by the service.
const EUI_INPUT = /^[0-9a-fA-F:\-\s]{16,23}$/;
const KEY_INPUT = /^[0-9a-fA-F:\-\s]{32,47}$/;

export class DeviceSetupLookupDto {
  @ApiProperty({ example: '00137A10000441DF' })
  @IsString()
  @Matches(EUI_INPUT, { message: 'dev_eui must be 16 hexadecimal characters' })
  dev_eui: string;

  @ApiProperty({ example: 8 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  location_id: number;
}

export class DeviceSetupDto extends DeviceSetupLookupDto {
  @ApiProperty({ example: 10, description: 'cw_device_type.id' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  device_type_id: number;

  @ApiProperty({ example: 'FL1 Smoke Detector' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @ApiPropertyOptional({ example: 'CropWatch' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(120)
  group?: string;

  @ApiPropertyOptional({ example: '2026-10-11' })
  @IsOptional()
  @IsISO8601()
  installed_at?: string;

  @ApiPropertyOptional({ example: 35.6812 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @ApiPropertyOptional({ example: 139.7671 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  long?: number;

  @ApiPropertyOptional({
    example: 14,
    description: 'Unassigned license seat to consume (required for non-staff)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  license_id?: number;

  @ApiPropertyOptional({
    example: '0000000000000000',
    description: 'OTAA JoinEUI — only when the keys are not on file',
  })
  @IsOptional()
  @IsString()
  @Matches(EUI_INPUT, { message: 'join_eui must be 16 hexadecimal characters' })
  join_eui?: string;

  @ApiPropertyOptional({
    description:
      'OTAA AppKey — only when the keys are not on file. Never returned.',
  })
  @IsOptional()
  @IsString()
  @Matches(KEY_INPUT, { message: 'app_key must be 32 hexadecimal characters' })
  app_key?: string;
}
