import { ApiProperty } from '@nestjs/swagger';

/** When a target applies: daylight only, night only, or at any time. */
export const CROP_TARGET_PERIODS = ['all', 'day', 'night'] as const;
export type CropTargetPeriod = (typeof CROP_TARGET_PERIODS)[number];

/** A crop a soil sensor can be set to (the crop picker's options). */
export class CropTypeDto {
  @ApiProperty({ example: 3 })
  id: number;

  @ApiProperty({ example: 'cucumber', description: 'Stable identifier.' })
  code: string;

  @ApiProperty({ example: 'Cucumber' })
  name_en: string;

  @ApiProperty({ example: 'キュウリ' })
  name_ja: string;

  @ApiProperty({ example: 'fruiting_vegetable' })
  category: string;

  @ApiProperty({ example: 'both', enum: ['greenhouse', 'open_field', 'both'] })
  cultivation: string;

  @ApiProperty({ example: 30, description: 'Display order in the picker.' })
  sort_order: number;
}

/**
 * A crop's growing target for one metric and period of the day: the optimal
 * band [optimal_min, optimal_max] inside the stress limits [min_value,
 * max_value]. Any bound may be null (no defensible value).
 */
export class CropTargetDto {
  @ApiProperty({
    example: 'soil_moisture',
    description:
      'soil_temperature, soil_water_tension, soil_moisture, soil_ec, soil_ec_1to5, soil_ph, air_temperature, air_humidity, co2, ppfd, dli or vpd.',
  })
  metric: string;

  @ApiProperty({ example: 'all', enum: CROP_TARGET_PERIODS })
  period: CropTargetPeriod;

  @ApiProperty({ example: '%' })
  unit: string;

  @ApiProperty({ example: 12.5, nullable: true, type: Number })
  min_value: number | null;

  @ApiProperty({ example: 19.3, nullable: true, type: Number })
  optimal_min: number | null;

  @ApiProperty({ example: 24.2, nullable: true, type: Number })
  optimal_max: number | null;

  @ApiProperty({ example: 35, nullable: true, type: Number })
  max_value: number | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'The basis of the values.',
  })
  notes: string | null;

  @ApiProperty({ type: [String], description: 'Source URLs for the values.' })
  sources: string[];
}

/** One crop with all of its growing targets. */
export class CropTypeDetailDto extends CropTypeDto {
  @ApiProperty({ nullable: true, type: String })
  notes: string | null;

  @ApiProperty({
    example: true,
    description: 'False once the crop is retired from the picker.',
  })
  is_active: boolean;

  @ApiProperty({ type: [CropTargetDto] })
  targets: CropTargetDto[];
}
