import { ApiProperty } from '@nestjs/swagger';

export class RuleActionTypeDto {
  @ApiProperty({
    description:
      'Stable identifier referenced by cw_rule_template_actions.action_type.',
  })
  id: number;

  @ApiProperty()
  name: string;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;
}
