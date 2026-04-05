import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, Max, Min } from 'class-validator';
import type { RelayNumber, RelayTargetState } from '../relay.types';

export class UpdateRelayDto {
  @ApiProperty({
    description: 'Relay number to update.',
    enum: [1, 2],
    example: 1,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2)
  relay: RelayNumber;

  @ApiProperty({
    description: 'Requested relay state.',
    enum: ['on', 'off'],
    example: 'on',
  })
  @IsIn(['on', 'off'])
  targetState: RelayTargetState;
}
