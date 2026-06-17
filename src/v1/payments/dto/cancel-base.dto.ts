import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

export class CancelBaseDto {
  @ApiProperty({
    required: false,
    default: true,
    description:
      'Cancel at the end of the current period (true) or revoke immediately (false). Defaults to true.',
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  atPeriodEnd?: boolean;
}
