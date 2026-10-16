import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

export const OVERVIEW_RANGES = ['24h', '7d', '30d'] as const;
export type OverviewRange = (typeof OVERVIEW_RANGES)[number];

/** Hours each range covers (cw_overview's p_hours). */
export const OVERVIEW_RANGE_HOURS: Record<OverviewRange, number> = {
  '24h': 24,
  '7d': 24 * 7,
  '30d': 24 * 30,
};

export class OverviewQueryDto {
  @ApiProperty({
    required: false,
    enum: OVERVIEW_RANGES,
    default: '24h',
    description: 'Window for the range-dependent numbers and the feed.',
  })
  @IsOptional()
  @IsIn(OVERVIEW_RANGES)
  range?: OverviewRange;
}
