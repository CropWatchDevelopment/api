import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class CreateBaseCheckoutDto {
  @ApiProperty({
    required: false,
    nullable: true,
    description:
      'Optional Stripe promotion code id (promo_...) to apply to the base subscription.',
  })
  @IsOptional()
  @IsString()
  discountId?: string | null;
}
