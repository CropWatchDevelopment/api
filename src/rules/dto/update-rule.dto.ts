import { PartialType } from '@nestjs/swagger';
import { Database } from '../../../database.types';
import { CreateRuleDto } from './create-rule.dto';

type RuleUpdate = Database['public']['Tables']['cw_rules']['Update'];

export class UpdateRuleDto
	extends PartialType(CreateRuleDto)
	implements RuleUpdate {}
