import { ApiProperty } from '@nestjs/swagger';

export const RULE_RUN_STATES = ['running', 'paused', 'scheduled'] as const;
export type RuleRunState = (typeof RULE_RUN_STATES)[number];

/** Why a rule last started or paused (cw_rule_templates.status_reason). */
export const RULE_STATUS_REASONS = [
  'manual',
  'auto_start',
  'auto_pause',
  'chain',
  'rule_action',
] as const;
export type RuleStatusReason = (typeof RULE_STATUS_REASONS)[number];

export const RULE_NEXT_START_SOURCES = ['date', 'chain'] as const;
export type RuleNextStartSource = (typeof RULE_NEXT_START_SOURCES)[number];

/** Another rule, named only when the caller can see it. */
export class RuleRefDto {
  @ApiProperty()
  id: number;

  @ApiProperty({ nullable: true, required: false })
  name: string | null;
}

export const RULE_TRIGGER_KINDS = ['sensor', 'schedule'] as const;
export type RuleTriggerKind = (typeof RULE_TRIGGER_KINDS)[number];

/** A rule another rule may start or pause, or start after its pause date. */
export class RuleOptionDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  name: string;

  @ApiProperty({
    description:
      'The one organization the rule sits in. A rule only switches rules of its own organization.',
  })
  orgId: string;

  @ApiProperty({ enum: RULE_TRIGGER_KINDS })
  triggerKind: RuleTriggerKind;
}

/** When a Date/Time rule runs. */
export class RuleScheduleDto {
  @ApiProperty({ example: '09:00', description: 'HH:mm, in `timezone`.' })
  timeOfDay: string;

  @ApiProperty({
    type: Number,
    isArray: true,
    description: 'ISO weekdays: 1 = Monday ... 7 = Sunday.',
  })
  daysOfWeek: number[];

  @ApiProperty({ example: 'Asia/Tokyo', description: 'IANA time zone.' })
  timezone: string;

  @ApiProperty({
    nullable: true,
    required: false,
    format: 'date-time',
    description: 'The next run; null while the rule is paused.',
  })
  nextFireAt: string | null;

  @ApiProperty({ nullable: true, required: false, format: 'date-time' })
  lastFiredAt: string | null;
}

export class RuleNextStartDto {
  @ApiProperty({ format: 'date-time' })
  at: string;

  @ApiProperty({
    enum: RULE_NEXT_START_SOURCES,
    description:
      "'date': the rule's own start date. 'chain': another rule starts it when that rule auto-pauses.",
  })
  source: RuleNextStartSource;

  @ApiProperty({ type: () => RuleRefDto, nullable: true, required: false })
  byRule: RuleRefDto | null;
}

export class RuleStatusDto {
  @ApiProperty({
    enum: RULE_RUN_STATES,
    description:
      "'scheduled': paused now, with a start already planned (see nextStart).",
  })
  state: RuleRunState;

  @ApiProperty({
    nullable: true,
    required: false,
    format: 'date-time',
    description:
      'When it last started or paused; the creation time for a rule that never changed.',
  })
  since: string | null;

  @ApiProperty({ enum: RULE_STATUS_REASONS, nullable: true, required: false })
  reason: RuleStatusReason | null;

  @ApiProperty({
    nullable: true,
    required: false,
    description:
      'Who started or paused it by hand. Never a CropWatch staff member for a customer.',
  })
  byUserName: string | null;

  @ApiProperty({ type: () => RuleRefDto, nullable: true, required: false })
  byRule: RuleRefDto | null;

  @ApiProperty({
    nullable: true,
    required: false,
    format: 'date-time',
    description: 'A running rule: when it pauses automatically.',
  })
  autoPauseAt: string | null;

  @ApiProperty({
    type: () => RuleRefDto,
    nullable: true,
    required: false,
    description: 'The rule that starts after that automatic pause.',
  })
  thenStart: RuleRefDto | null;

  @ApiProperty({
    type: () => RuleNextStartDto,
    nullable: true,
    required: false,
  })
  nextStart: RuleNextStartDto | null;
}
