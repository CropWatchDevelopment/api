import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';
import { SEAT_MINIMUM } from '../payments.types';

export class ChangeSeatsDto {
  @ApiProperty({
    description: `Absolute target number of device licenses (seats). Must be at least ${SEAT_MINIMUM} and at least the number of currently assigned licenses. To go lower, cancel the device subscription instead.`,
    minimum: SEAT_MINIMUM,
    example: 5,
  })
  @Type(() => Number)
  @IsInt()
  @Min(SEAT_MINIMUM)
  seats: number;
}
