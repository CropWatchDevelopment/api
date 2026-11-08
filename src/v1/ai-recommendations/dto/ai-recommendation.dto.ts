import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const AI_REPORT_TYPES = ['daily', 'weekly'] as const;
export type AiReportType = (typeof AI_REPORT_TYPES)[number];

/** One "what this value means" line per measurement, written by the rules engine (never the LLM). */
export class AiRecommendationDetailDto {
  @ApiProperty({ example: 'air_temperature' })
  metric!: string;

  @ApiProperty({ enum: ['all', 'day', 'night'], example: 'night' })
  period!: string;

  @ApiProperty({
    example:
      '夜間の気温：平均10.8°C（最低5.7°C〜最高17.8°C）、目標12〜16°C。安全範囲外。…',
  })
  ja!: string;

  @ApiProperty({
    example:
      'Night-time air temperature: average 10.8 °C (range 5.7 °C–17.8 °C); target 12–16 °C. Outside safe limits. …',
  })
  en!: string;
}

/** Something the grower should act on; every number comes from the rules engine. */
export class AiRecommendationFindingDto {
  @ApiProperty({ example: 'air_temperature' })
  metric!: string;

  @ApiProperty({ enum: ['all', 'day', 'night'], example: 'night' })
  period!: string;

  @ApiProperty({ minimum: 2, maximum: 3, example: 3 })
  severity!: number;

  @ApiProperty({ enum: ['target', 'sensor'], example: 'target' })
  kind!: string;

  @ApiProperty({ example: 'raise_night_temp' })
  action!: string;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description: 'p10 when low, p90 when high, the day total for DLI',
    example: 6,
  })
  value?: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true, example: 10.8 })
  mean?: number | null;

  @ApiPropertyOptional({ enum: ['low', 'high'], nullable: true })
  direction?: string | null;
}

/**
 * A daily or weekly growing-environment report for one soil sensor, written by
 * the cw-ai-services worker into cw_ai_recommendations
 * (supabase/updates/038_ai_recommendations.sql).
 */
export class AiRecommendationDto {
  @ApiProperty({ example: 3 })
  id!: number;

  @ApiProperty({ example: '343634316633780C' })
  dev_eui!: string;

  @ApiProperty({ enum: AI_REPORT_TYPES, example: 'daily' })
  report_type!: AiReportType;

  @ApiProperty({
    description: 'First local day covered (YYYY-MM-DD)',
    example: '2026-11-08',
  })
  period_start!: string;

  @ApiProperty({
    description: 'Last local day covered, inclusive',
    example: '2026-11-08',
  })
  period_end!: string;

  @ApiProperty({ example: 'Asia/Tokyo' })
  timezone!: string;

  @ApiProperty({ enum: ['good', 'action', 'insufficient_data'] })
  status!: string;

  @ApiProperty({
    minimum: 0,
    maximum: 3,
    description:
      '0 ok, 1 close to target, 2 needs attention, 3 outside safe limits',
  })
  max_severity!: number;

  @ApiProperty()
  headline_ja!: string;

  @ApiProperty()
  body_ja!: string;

  @ApiProperty()
  headline_en!: string;

  @ApiProperty()
  body_en!: string;

  @ApiProperty({ type: AiRecommendationFindingDto, isArray: true })
  findings!: AiRecommendationFindingDto[];

  @ApiProperty({ type: AiRecommendationDetailDto, isArray: true })
  details!: AiRecommendationDetailDto[];

  @ApiProperty({
    enum: ['llm', 'template'],
    description:
      'llm: phrased by the local model and validated; template: fixed text',
  })
  text_source!: string;

  @ApiProperty({ example: '2026-11-08T16:32:49.779Z' })
  created_at!: string;

  @ApiProperty({ example: '2026-11-08T16:32:49.779Z' })
  updated_at!: string;
}
