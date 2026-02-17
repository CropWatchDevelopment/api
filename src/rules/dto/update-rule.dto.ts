import { ApiProperty, PartialType } from '@nestjs/swagger';
import { Database } from '../../../database.types';
import { CreateRuleDto } from './create-rule.dto';
import { RuleCriteriaDto } from './rule-criteria.dto';

type RuleUpdate = Database['public']['Tables']['cw_rules']['Update'];

export class UpdateRuleDto
	extends PartialType(CreateRuleDto)
	implements RuleUpdate {
	@ApiProperty({
		type: () => RuleCriteriaDto,
		isArray: true,
		required: false,
		description: 'Criteria entries for this rule (cw_rule_criteria).',
	})
	cw_rule_criteria?: RuleCriteriaDto[];
}
