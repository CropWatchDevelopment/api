import { ApiProperty } from '@nestjs/swagger';
import { Database } from '../../../database.types';

type RuleCriteriaRow = Database['public']['Tables']['cw_rule_criteria']['Row'];

export class RuleCriteriaDto implements RuleCriteriaRow {
  @ApiProperty({ format: 'date-time' })
  created_at: string;

  @ApiProperty({ nullable: true, required: false })
  criteria_id: number | null;

  @ApiProperty()
  id: number;

  @ApiProperty()
  operator: string;

  @ApiProperty({ nullable: true, required: false })
  parent_id: string | null;

  @ApiProperty({ nullable: true, required: false })
  reset_value: number | null;

  @ApiProperty()
  ruleGroupId: string;

  @ApiProperty()
  subject: string;

  @ApiProperty()
  trigger_value: number;
}
