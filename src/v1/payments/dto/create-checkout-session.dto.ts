import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CustomerBillingAddressDto {
  @ApiProperty({
    description: 'ISO 3166-1 alpha-2 country code.',
    example: 'US',
  })
  country: string;

  @ApiPropertyOptional({ example: '123 Main St' })
  line1?: string;

  @ApiPropertyOptional({ example: 'Apt 2A' })
  line2?: string;

  @ApiPropertyOptional({ example: '10001' })
  postal_code?: string;

  @ApiPropertyOptional({ example: 'New York' })
  city?: string;

  @ApiPropertyOptional({ example: 'NY' })
  state?: string;
}

export class CreateCheckoutSessionDto {
  @ApiProperty({
    type: [String],
    description: 'Polar product IDs to include in the checkout.',
    example: ['f47ac10b-58cc-4372-a567-0e02b2c3d479'],
  })
  products: string[];

  @ApiPropertyOptional({
    description: 'Redirect URL after successful checkout.',
    example: 'https://app.cropwatch.io/billing/success',
  })
  success_url?: string;

  @ApiPropertyOptional({
    description: 'URL to return to when customer leaves checkout.',
    example: 'https://app.cropwatch.io/billing',
  })
  return_url?: string;

  @ApiPropertyOptional({ example: 'Jane Smith' })
  customer_name?: string;

  @ApiPropertyOptional({ example: 'jane@example.com' })
  customer_email?: string;

  @ApiPropertyOptional({ type: () => CustomerBillingAddressDto })
  customer_billing_address?: CustomerBillingAddressDto;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: {
      oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }],
    },
    description: 'Metadata copied to order/subscription.',
    example: { plan: 'pro', seats: 5, trial: true },
  })
  metadata?: Record<string, string | number | boolean>;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: {
      oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }],
    },
    description: 'Metadata copied to customer when created.',
    example: { source: 'dashboard', region: 'us-east-1' },
  })
  customer_metadata?: Record<string, string | number | boolean>;

  @ApiPropertyOptional({ default: true })
  allow_discount_codes?: boolean;

  @ApiPropertyOptional({ default: true })
  allow_trial?: boolean;
}
