import { ApiProperty } from '@nestjs/swagger';
import { RuleTemplateStateDto } from './rule-template-state.dto';

export class RuleTemplateAssignmentDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  devEui: string;

  @ApiProperty()
  templateId: number;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty({ nullable: true, required: false, format: 'date-time' })
  createdAt: string | null;

  @ApiProperty({ nullable: true, required: false })
  deviceName: string | null;

  @ApiProperty({ nullable: true, required: false })
  permissionLevel: number | null;

  @ApiProperty({ nullable: true, required: false, type: () => RuleTemplateStateDto })
  state: RuleTemplateStateDto | null;
}
