import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { TableUpdate } from '../../types/supabase';

const THEMES = ['light', 'dark', 'system'] as const;
const TEMPERATURE_UNITS = ['celsius', 'fahrenheit', 'kelvin'] as const;
const WEIGHT_UNITS = ['kg', 'lb'] as const;
const EC_UNITS = ['ms_cm', 'ds_cm', 'us_cm'] as const;
const WATER_LEVEL_UNITS = ['cm', 'mm', 'inch', 'foot', 'meter', 'yard'] as const;
const DISTANCE_UNITS = ['km', 'mi'] as const;
const AREA_UNITS = ['hectares', 'acres', 'square_meters'] as const;
const SOIL_MOISTURE_UNITS = ['vwc_percent', 'relative_percent', 'kpa', 'centibar'] as const;
const PRESSURE_UNITS = ['hpa', 'kpa', 'bar', 'psi'] as const;
const RAINFALL_UNITS = ['mm', 'cm', 'in'] as const;
const WIND_SPEED_UNITS = ['m_s', 'km_h', 'mph', 'kt'] as const;
const CO2_UNITS = ['ppm', 'mg_m3'] as const;
const DATE_FORMATS = ['yyyy_mm_dd', 'dd_mm_yyyy', 'mm_dd_yyyy'] as const;
const TIME_FORMATS = ['24h', '12h'] as const;

export class UpdatePreferencesDto implements TableUpdate<'profile_preferences'> {
  @ApiProperty({ required: false, nullable: true, enum: THEMES })
  @IsOptional()
  @IsIn(THEMES)
  theme?: string | null;

  @ApiProperty({ required: false, nullable: true, enum: TEMPERATURE_UNITS })
  @IsOptional()
  @IsIn(TEMPERATURE_UNITS)
  temperature_unit?: string | null;

  @ApiProperty({ required: false, nullable: true, enum: WEIGHT_UNITS })
  @IsOptional()
  @IsIn(WEIGHT_UNITS)
  weight_unit?: string | null;

  @ApiProperty({ required: false, nullable: true, enum: EC_UNITS })
  @IsOptional()
  @IsIn(EC_UNITS)
  ec_unit?: string | null;

  @ApiProperty({ required: false, nullable: true, enum: WATER_LEVEL_UNITS })
  @IsOptional()
  @IsIn(WATER_LEVEL_UNITS)
  water_level_unit?: string | null;

  @ApiProperty({ required: false, nullable: true, example: 'Asia/Tokyo' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string | null;

  @ApiProperty({ required: false, nullable: true, enum: DISTANCE_UNITS })
  @IsOptional()
  @IsIn(DISTANCE_UNITS)
  distance_unit?: string | null;

  @ApiProperty({ required: false, nullable: true, enum: AREA_UNITS })
  @IsOptional()
  @IsIn(AREA_UNITS)
  area_unit?: string | null;

  @ApiProperty({ required: false, nullable: true, enum: SOIL_MOISTURE_UNITS })
  @IsOptional()
  @IsIn(SOIL_MOISTURE_UNITS)
  soil_moisture_unit?: string | null;

  @ApiProperty({ required: false, nullable: true, enum: PRESSURE_UNITS })
  @IsOptional()
  @IsIn(PRESSURE_UNITS)
  pressure_unit?: string | null;

  @ApiProperty({ required: false, nullable: true, enum: RAINFALL_UNITS })
  @IsOptional()
  @IsIn(RAINFALL_UNITS)
  rainfall_unit?: string | null;

  @ApiProperty({ required: false, nullable: true, enum: WIND_SPEED_UNITS })
  @IsOptional()
  @IsIn(WIND_SPEED_UNITS)
  wind_speed_unit?: string | null;

  @ApiProperty({ required: false, nullable: true, enum: CO2_UNITS })
  @IsOptional()
  @IsIn(CO2_UNITS)
  co2_unit?: string | null;

  @ApiProperty({ required: false, nullable: true, enum: DATE_FORMATS })
  @IsOptional()
  @IsIn(DATE_FORMATS)
  date_format?: string | null;

  @ApiProperty({ required: false, nullable: true, enum: TIME_FORMATS })
  @IsOptional()
  @IsIn(TIME_FORMATS)
  time_format?: string | null;
}
