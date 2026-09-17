import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';
import { SEAT_MINIMUM } from '../payments.types';

export class CreateDeviceCheckoutDto {
  @ApiProperty({
    description: `Number of device licenses (seats) to purchase initially. Minimum ${SEAT_MINIMUM}.`,
    minimum: SEAT_MINIMUM,
    example: SEAT_MINIMUM,
  })
  @Type(() => Number)
  @IsInt()
  @Min(SEAT_MINIMUM)
  quantity: number;
}
