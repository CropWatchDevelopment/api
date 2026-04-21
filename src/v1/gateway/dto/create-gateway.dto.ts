import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsISO8601,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { TableInsert } from '../../types/supabase';

export class CreateGatewayDto implements TableInsert<'cw_gateways'> {
  @ApiProperty({
    description: 'The external gateway identifier.',
    example: 'cropwatch-gateway-001',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  gateway_id: string;

  @ApiProperty({
    description: 'Gateway display name.',
    example: 'North Greenhouse Gateway',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  gateway_name: string;

  @ApiProperty({
    description: 'Whether the gateway is currently online.',
    example: true,
  })
  @IsBoolean()
  is_online: boolean;

  @ApiProperty({
    required: false,
    description:
      'Whether this gateway can be visible outside explicit ownership.',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  is_public?: boolean;

  @ApiProperty({ required: false, format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  created_at?: string;

  @ApiProperty({ required: false, nullable: true, format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  updated_at?: string | null;

  @ApiProperty({ required: false, description: 'Internal gateway row id.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  id?: number;
}
