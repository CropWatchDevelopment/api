import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import type { BillingMode } from '../payments.types';

export class AdminSetBillingModeDto {
  @ApiProperty({
    enum: ['stripe', 'manual'],
    description:
      "'stripe' = self-serve Stripe subscriptions; 'manual' = invoiced outside Stripe, seats granted by staff.",
  })
  @IsIn(['stripe', 'manual'])
  billingMode: BillingMode;
}
