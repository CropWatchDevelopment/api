import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

export class CreateDeviceCheckoutDto {
  @ApiProperty({
    description: 'Number of device licenses (seats) to purchase initially.',
    minimum: 1,
    example: 1,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity: number;
}
