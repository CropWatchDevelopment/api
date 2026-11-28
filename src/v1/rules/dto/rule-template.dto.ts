import { ApiProperty } from '@nestjs/swagger';
import { RuleTemplateActionDto } from './rule-template-action.dto';
import { RuleTemplateAssignmentDto } from './rule-template-assignment.dto';
import { RuleTemplateCriterionDto } from './rule-template-criterion.dto';
import {
  RULE_TRIGGER_KINDS,
  RuleScheduleDto,
  RuleStatusDto,
  type RuleTriggerKind,
} from './rule-status.dto';

export class RuleTemplateDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  name: string;

  @ApiProperty({ nullable: true, required: false })
  description: string | null;

  @ApiProperty({ nullable: true, required: false })
  deviceTypeId: number | null;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty({ nullable: true, required: false, format: 'date-time' })
  createdAt: string | null;

  @ApiProperty({ nullable: true, required: false, format: 'date-time' })
  autoStartAt: string | null;

  @ApiProperty({ nullable: true, required: false, format: 'date-time' })
  autoPauseAt: string | null;

  @ApiProperty({
    nullable: true,
    required: false,
    description: 'The rule that starts when this one pauses on its pause date.',
  })
  onAutoPauseStartTemplateId: number | null;

  @ApiProperty({ type: () => RuleStatusDto })
  status: RuleStatusDto;

  @ApiProperty({
    enum: RULE_TRIGGER_KINDS,
    description:
      "'sensor': fires on device readings. 'schedule': a Date/Time rule (see `schedule`).",
  })
  triggerKind: RuleTriggerKind;

  @ApiProperty({
    nullable: true,
    required: false,
    description: 'The organization that owns a Date/Time rule.',
  })
  orgId: string | null;

  @ApiProperty({ type: () => RuleScheduleDto, nullable: true, required: false })
  schedule: RuleScheduleDto | null;

  @ApiProperty({
    nullable: true,
    required: false,
    description:
      'Re-send after this many further reports that still break the alert threshold; null = off.',
  })
  resendAfterReports: number | null;

  @ApiProperty({ description: 'Re-sends per alarm at most.' })
  resendMax: number;

  @ApiProperty({ type: () => RuleTemplateAssignmentDto, isArray: true })
  assignments: RuleTemplateAssignmentDto[];

  @ApiProperty({ type: () => RuleTemplateCriterionDto, isArray: true })
  criteria: RuleTemplateCriterionDto[];

  @ApiProperty({ type: () => RuleTemplateActionDto, isArray: true })
  actions: RuleTemplateActionDto[];
}
