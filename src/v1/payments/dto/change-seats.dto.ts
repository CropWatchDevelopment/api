import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

export class ChangeSeatsDto {
  @ApiProperty({
    description:
      'Absolute target number of device licenses (seats). Must be at least the number of currently assigned licenses.',
    minimum: 0,
    example: 3,
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  seats: number;
}
