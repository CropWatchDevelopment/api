import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const AI_REPORT_TYPES = ['daily', 'weekly'] as const;
export type AiReportType = (typeof AI_REPORT_TYPES)[number];

/** A finding's text in one language, for the app's table and action list. */
export class AiFindingTextDto {
  @ApiProperty({ example: 'Night-time air temperature' })
  what!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'The low or high end (p10/p90), or the day total for DLI; null for a sensor fault',
    example: '6 °C',
  })
  value!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '10.8 °C' })
  average!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '12–16 °C' })
  target!: string | null;

  @ApiProperty({ example: 'Warmer nights' })
  action_title!: string;

  @ApiProperty({
    example:
      'Run the heater, or close side vents and thermal screens earlier in the evening.',
  })
  action!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Set when another action covers this finding (e.g. heating lowers night humidity)',
  })
  note!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Weekly reports: on how many days it was off',
    example: '3 of 7 days',
  })
  days_off!: string | null;
}

/** How the app shows a finding (deterministic; written with the report). */
export class AiFindingDisplayDto {
  @ApiProperty({
    enum: ['below', 'above', 'low_end_below', 'peak_above', 'invalid'],
    description:
      'low_end_below / peak_above: the low or high end is off target while the average is inside it',
  })
  status!: string;

  @ApiProperty({
    enum: ['low', 'high'],
    nullable: true,
    description: 'Which end value is when an average is shown',
  })
  kind!: string | null;

  @ApiProperty({ type: AiFindingTextDto })
  ja!: AiFindingTextDto;

  @ApiProperty({ type: AiFindingTextDto })
  en!: AiFindingTextDto;
}

/** One "what this value means" line per measurement, written by the rules engine (never the LLM). */
export class AiRecommendationDetailDto {
  @ApiProperty({ example: 'air_temperature' })
  metric!: string;

  @ApiProperty({ enum: ['all', 'day', 'night'], example: 'night' })
  period!: string;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      '0 ok, 1 close to target, 2 needs attention, 3 outside safe limits; null when not judged',
  })
  severity!: number | null;

  @ApiProperty({ example: '夜間の気温' })
  what_ja!: string;

  @ApiProperty({ example: 'Night-time air temperature' })
  what_en!: string;

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

  @ApiPropertyOptional({
    type: AiFindingDisplayDto,
    description: 'Absent on reports written before the display format',
  })
  display?: AiFindingDisplayDto;
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
