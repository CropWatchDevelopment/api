import { ApiProperty } from '@nestjs/swagger';

export type RuleTemplateActionConfig =
  | string
  | number
  | boolean
  | null
  | RuleTemplateActionConfig[]
  | { [key: string]: RuleTemplateActionConfig | undefined };

export class RuleTemplateActionDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  templateId: number;

  @ApiProperty({
    description:
      'Foreign key to cw_rule_action_types.id identifying the action.',
  })
  actionType: number;

  @ApiProperty({ nullable: true, required: false })
  actionTypeName: string | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'Free-form configuration JSON for this action.',
  })
  config: RuleTemplateActionConfig;

  @ApiProperty({ nullable: true, required: false, format: 'date-time' })
  createdAt: string | null;
}
