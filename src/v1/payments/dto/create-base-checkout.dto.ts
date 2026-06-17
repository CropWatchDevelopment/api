import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class CreateBaseCheckoutDto {
  @ApiProperty({
    required: false,
    nullable: true,
    description: 'Optional Polar discount id to apply to the base subscription.',
  })
  @IsOptional()
  @IsString()
  discountId?: string | null;
}
