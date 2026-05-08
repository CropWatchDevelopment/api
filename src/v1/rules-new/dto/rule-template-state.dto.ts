import { ApiProperty } from '@nestjs/swagger';

export class RuleTemplateStateDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  devEui: string;

  @ApiProperty()
  templateId: number;

  @ApiProperty()
  isTriggered: boolean;

  @ApiProperty({ nullable: true, required: false, format: 'date-time' })
  lastTriggeredAt: string | null;

  @ApiProperty({ nullable: true, required: false, format: 'date-time' })
  lastResetAt: string | null;
}
