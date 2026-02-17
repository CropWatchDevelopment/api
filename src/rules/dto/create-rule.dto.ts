import { ApiProperty } from '@nestjs/swagger';
import { Database } from '../../../database.types';
import { RuleCriteriaDto } from './rule-criteria.dto';

type RuleInsert = Database['public']['Tables']['cw_rules']['Insert'];

export class CreateRuleDto implements RuleInsert {
	@ApiProperty()
	action_recipient: string;

	@ApiProperty()
	name: string;

	@ApiProperty()
	notifier_type: number;

	@ApiProperty()
	ruleGroupId: string;

	@ApiProperty({ required: false })
	created_at?: string;

	@ApiProperty({ required: false, nullable: true })
	dev_eui?: string | null;

	@ApiProperty({ required: false })
	id?: number;

	@ApiProperty({ required: false })
	is_triggered?: boolean;

	@ApiProperty({ required: false, nullable: true })
	last_triggered?: string | null;

	@ApiProperty({ required: false })
	profile_id?: string;

	@ApiProperty({ required: false, nullable: true })
	send_using?: string | null;

	@ApiProperty({ required: false })
	trigger_count?: number;

	@ApiProperty({
		type: () => RuleCriteriaDto,
		isArray: true,
		required: false,
		description: 'Criteria entries for this rule (cw_rule_criteria).',
	})
	cw_rule_criteria?: RuleCriteriaDto[];
}
