import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

export class AdminSetManualSeatsDto {
  @ApiProperty({
    description:
      'Absolute number of staff-granted device licenses the user should have. Cannot go below the number of assigned staff-granted licenses.',
    minimum: 0,
    example: 3,
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  seats: number;
}
