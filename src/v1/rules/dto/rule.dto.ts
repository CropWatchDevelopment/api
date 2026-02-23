import { ApiProperty } from '@nestjs/swagger';
import { Database } from '../../../../database.types';
import { RuleCriteriaDto } from './rule-criteria.dto';

type RuleRow = Database['public']['Tables']['cw_rules']['Row'];

export class RuleDto implements RuleRow {
	@ApiProperty()
	id: number;

	@ApiProperty()
	name: string;

	@ApiProperty()
	action_recipient: string;

	@ApiProperty()
	notifier_type: number;

	@ApiProperty()
	ruleGroupId: string;

	@ApiProperty()
	profile_id: string;

	@ApiProperty({ nullable: true, required: false })
	dev_eui: string | null;

	@ApiProperty({ nullable: true, required: false })
	send_using: string | null;

	@ApiProperty()
	is_triggered: boolean;

	@ApiProperty()
	trigger_count: number;

	@ApiProperty({ format: 'date-time' })
	created_at: string;

	@ApiProperty({ nullable: true, required: false, format: 'date-time' })
	last_triggered: string | null;

	@ApiProperty({
		type: () => RuleCriteriaDto,
		isArray: true,
		required: false,
		description: 'Rows from cw_rule_criteria linked by ruleGroupId.',
	})
	cw_rule_criteria?: RuleCriteriaDto[];
}
