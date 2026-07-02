import { ApiProperty } from '@nestjs/swagger';

export class RuleTriggerLogDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  devEui: string;

  @ApiProperty({ nullable: true })
  deviceName: string | null;

  @ApiProperty()
  templateId: number;

  @ApiProperty({ nullable: true, required: false, format: 'date-time' })
  triggeredAt: string | null;

  @ApiProperty({ nullable: true, required: false })
  triggeredValue: number | null;

  @ApiProperty({ nullable: true, required: false, format: 'date-time' })
  resetAt: string | null;

  @ApiProperty({ nullable: true, required: false })
  resetValue: number | null;

  @ApiProperty({ nullable: true, required: false, format: 'date-time' })
  createdAt: string | null;
}
