import { ApiProperty } from '@nestjs/swagger';

export class RuleDeviceStateEntryDto {
  @ApiProperty()
  devEui: string;

  @ApiProperty()
  templateId: number;

  @ApiProperty()
  isTriggered: boolean;

  @ApiProperty({
    nullable: true,
    format: 'date-time',
    description:
      'Most recent of last_triggered_at / last_reset_at for this pair.',
  })
  lastChange: string | null;
}

export class RuleDeviceStateDto {
  @ApiProperty({
    format: 'date-time',
    description:
      'Server time at response build, so low-power clients can sanity-check their clock.',
  })
  ts: string;

  @ApiProperty({
    type: RuleDeviceStateEntryDto,
    isArray: true,
    description:
      'Only pairs that have a state row are returned. cw_rule_state rows are created lazily on first trigger, so a requested device absent from this list has never triggered and must be treated as isTriggered = false.',
  })
  states: RuleDeviceStateEntryDto[];
}
