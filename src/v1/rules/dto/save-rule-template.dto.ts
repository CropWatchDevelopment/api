import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsDefined,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { RULE_TRIGGER_KINDS, type RuleTriggerKind } from './rule-status.dto';
import type { RuleTemplateActionConfig } from './rule-template-action.dto';

export class SaveRuleTemplateCriterionDto {
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsInt()
  id?: number | null;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  subject: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  operator: string;

  @ApiProperty()
  @IsNumber()
  triggerValue: number;

  @ApiProperty()
  @IsNumber()
  resetValue: number;
}

export class SaveRuleTemplateActionDto {
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsInt()
  id?: number | null;

  @ApiProperty({
    description:
      'Foreign key to cw_rule_action_types.id identifying the action.',
  })
  @IsInt()
  actionType: number;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'Free-form configuration JSON for this action.',
  })
  @IsDefined()
  config: RuleTemplateActionConfig;
}

export class SaveRuleScheduleDto {
  @ApiProperty({ example: '09:00', description: 'HH:mm, 24-hour clock.' })
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  timeOfDay: string;

  @ApiProperty({
    type: Number,
    isArray: true,
    description: 'ISO weekdays: 1 = Monday ... 7 = Sunday.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  daysOfWeek: number[];

  @ApiProperty({ example: 'Asia/Tokyo', description: 'IANA time zone.' })
  @IsString()
  @IsNotEmpty()
  timezone: string;
}

export class SaveRuleTemplateDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    required: false,
    enum: RULE_TRIGGER_KINDS,
    description:
      "'sensor' (default) or 'schedule' for a Date/Time rule. Fixed once the rule exists.",
  })
  @IsOptional()
  @IsIn(RULE_TRIGGER_KINDS)
  triggerKind?: RuleTriggerKind;

  @ApiProperty({
    type: () => SaveRuleScheduleDto,
    required: false,
    description: 'Required for a Date/Time rule, ignored for a sensor rule.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => SaveRuleScheduleDto)
  schedule?: SaveRuleScheduleDto;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  description?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsInt()
  deviceTypeId?: number | null;

  @ApiProperty({
    required: false,
    description:
      'Running (true) or paused (false). Left out: a new rule runs, an existing rule keeps its status.',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiProperty({
    required: false,
    nullable: true,
    format: 'date-time',
    description:
      'Start the rule at this instant (ISO 8601 with a UTC offset). null clears it; left out keeps it.',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  autoStartAt?: string | null;

  @ApiProperty({
    required: false,
    nullable: true,
    format: 'date-time',
    description:
      'Pause the rule at this instant (ISO 8601 with a UTC offset). null clears it; left out keeps it.',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  autoPauseAt?: string | null;

  @ApiProperty({
    required: false,
    nullable: true,
    description:
      'The rule to start when this one pauses on its pause date. null clears it; left out keeps it.',
  })
  @IsOptional()
  @IsInt()
  onAutoPauseStartTemplateId?: number | null;

  @ApiProperty({
    required: false,
    nullable: true,
    minimum: 3,
    maximum: 1000,
    description:
      'Re-send: while the alarm stays open, send the actions marked `config.repeat` again after this many further reports that still break the alert threshold. null turns it off; left out keeps it. Not for Date/Time rules.',
  })
  @IsOptional()
  @IsInt()
  @Min(3)
  @Max(1000)
  resendAfterReports?: number | null;

  @ApiProperty({
    required: false,
    minimum: 1,
    maximum: 50,
    description:
      'Re-send: how many times at most per alarm (default 5). Left out keeps it.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  resendMax?: number;

  @ApiProperty({
    type: String,
    isArray: true,
    description: 'At least one for a sensor rule; empty for a Date/Time rule.',
  })
  @IsArray()
  @IsString({ each: true })
  devEuis: string[];

  @ApiProperty({
    type: () => SaveRuleTemplateCriterionDto,
    isArray: true,
    description: 'At least one for a sensor rule; empty for a Date/Time rule.',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SaveRuleTemplateCriterionDto)
  criteria: SaveRuleTemplateCriterionDto[];

  @ApiProperty({ type: () => SaveRuleTemplateActionDto, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SaveRuleTemplateActionDto)
  actions: SaveRuleTemplateActionDto[];
}
