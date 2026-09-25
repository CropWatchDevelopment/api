import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEmail, IsInt, IsOptional, Max, Min } from 'class-validator';
import {
  MAX_PERMISSION_LEVEL,
  MIN_PERMISSION_LEVEL,
} from '../../common/permission-levels';

/**
 * Body of PATCH /v1/locations/:id/permission-level.
 *
 * The location is identified by the ROUTE param only. `location_id` is
 * accepted for backwards compatibility with existing clients but must match
 * the route (the controller rejects a mismatch) — it previously drove the
 * write directly, which allowed cross-location permission escalation.
 */
export class UpdateLocationUserPermissionLevelDto {
  @ApiProperty({ description: 'Email of the user whose level is changed' })
  @IsEmail()
  email: string;

  @ApiProperty({
    description: `Permission level between ${MIN_PERMISSION_LEVEL} and ${MAX_PERMISSION_LEVEL}`,
  })
  @Type(() => Number)
  @IsInt()
  @Min(MIN_PERMISSION_LEVEL)
  @Max(MAX_PERMISSION_LEVEL)
  permission_level: number;

  @ApiProperty({
    required: false,
    description: 'Legacy field; must match the route id when present',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  location_id?: number;
}
