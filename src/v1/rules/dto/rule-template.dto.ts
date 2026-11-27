import { ApiProperty } from '@nestjs/swagger';
import { RuleTemplateActionDto } from './rule-template-action.dto';
import { RuleTemplateAssignmentDto } from './rule-template-assignment.dto';
import { RuleTemplateCriterionDto } from './rule-template-criterion.dto';
import { RuleStatusDto } from './rule-status.dto';

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

  @ApiProperty({ type: () => RuleTemplateAssignmentDto, isArray: true })
  assignments: RuleTemplateAssignmentDto[];

  @ApiProperty({ type: () => RuleTemplateCriterionDto, isArray: true })
  criteria: RuleTemplateCriterionDto[];

  @ApiProperty({ type: () => RuleTemplateActionDto, isArray: true })
  actions: RuleTemplateActionDto[];
}
