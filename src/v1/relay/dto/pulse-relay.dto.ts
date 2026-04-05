import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';
import type { RelayNumber } from '../relay.types';

export class PulseRelayDto {
  @ApiProperty({
    description: 'Relay number to pulse.',
    enum: [1, 2],
    example: 1,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2)
  relay: RelayNumber;

  @ApiProperty({
    description:
      'Pulse duration in whole seconds. The relay will be driven on for this long before reverting to its prior state.',
    example: 60,
    maximum: 4294967,
    minimum: 1,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(4294967)
  durationSeconds: number;
}
