import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsDefined,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import type { RuleTemplateActionConfig } from './rule-template-action.dto';

export class SaveRuleTemplateCriterionDto {
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsInt()
  id?: number | null;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  subject: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  operator: string;

  @ApiProperty()
  @IsNumber()
  triggerValue: number;

  @ApiProperty()
  @IsNumber()
  resetValue: number;
}

export class SaveRuleTemplateActionDto {
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsInt()
  id?: number | null;

  @ApiProperty({
    description:
      'Foreign key to cw_rule_action_types.id identifying the action.',
  })
  @IsInt()
  actionType: number;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'Free-form configuration JSON for this action.',
  })
  @IsDefined()
  config: RuleTemplateActionConfig;
}

export class SaveRuleTemplateDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  description?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsInt()
  deviceTypeId?: number | null;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiProperty({ type: String, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  devEuis: string[];

  @ApiProperty({ type: () => SaveRuleTemplateCriterionDto, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SaveRuleTemplateCriterionDto)
  criteria: SaveRuleTemplateCriterionDto[];

  @ApiProperty({ type: () => SaveRuleTemplateActionDto, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SaveRuleTemplateActionDto)
  actions: SaveRuleTemplateActionDto[];
}
