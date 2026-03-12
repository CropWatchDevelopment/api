import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsISO8601, IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';
import { Database } from '../../../../database.types';
import { RuleCriteriaDto } from './rule-criteria.dto';

type RuleInsert = Database['public']['Tables']['cw_rules']['Insert'];

export class CreateRuleDto implements RuleInsert {
	@ApiProperty()
	@IsString()
	@IsNotEmpty()
	action_recipient: string;

	@ApiProperty()
	@IsString()
	@IsNotEmpty()
	name: string;

	@ApiProperty()
	@Type(() => Number)
	@IsInt()
	notifier_type: number;

	@ApiProperty()
	@IsString()
	@IsNotEmpty()
	ruleGroupId: string;

	@ApiProperty({ required: false })
	@IsOptional()
	@IsISO8601()
	created_at?: string;

	@ApiProperty({ required: false, nullable: true })
	@IsString()
	@IsNotEmpty()
	dev_eui?: string | null;

	@ApiProperty({ required: false })
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	id?: number;

	@ApiProperty({ required: false })
	@IsOptional()
	@IsBoolean()
	is_triggered?: boolean;

	@ApiProperty({ required: false, nullable: true })
	@IsOptional()
	@IsISO8601()
	last_triggered?: string | null;

	@ApiProperty({ required: false })
	@IsOptional()
	@IsString()
	profile_id?: string;

	@ApiProperty({ required: false, nullable: true })
	@IsOptional()
	@IsString()
	send_using?: string | null;

	@ApiProperty({ required: false })
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(0)
	trigger_count?: number;

	@ApiProperty({
		type: () => RuleCriteriaDto,
		isArray: true,
		required: false,
		description: 'Criteria entries for this rule (cw_rule_criteria).',
	})
	@IsOptional()
	@IsArray()
	cw_rule_criteria?: RuleCriteriaDto[];
}
