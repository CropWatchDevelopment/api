import { ApiProperty } from '@nestjs/swagger';

export class RuleTemplateCriterionDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  templateId: number;

  @ApiProperty()
  subject: string;

  @ApiProperty()
  operator: string;

  @ApiProperty()
  triggerValue: number;

  @ApiProperty()
  resetValue: number;

  @ApiProperty({ nullable: true, required: false, format: 'date-time' })
  createdAt: string | null;
}
