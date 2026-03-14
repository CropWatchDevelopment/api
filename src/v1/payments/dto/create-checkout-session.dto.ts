import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class CustomerBillingAddressDto {
  @ApiProperty({
    description: 'ISO 3166-1 alpha-2 country code.',
    example: 'US',
  })
  @IsString()
  @IsNotEmpty()
  country: string;

  @ApiPropertyOptional({ example: '123 Main St' })
  @IsOptional()
  @IsString()
  line1?: string;

  @ApiPropertyOptional({ example: 'Apt 2A' })
  @IsOptional()
  @IsString()
  line2?: string;

  @ApiPropertyOptional({ example: '10001' })
  @IsOptional()
  @IsString()
  postal_code?: string;

  @ApiPropertyOptional({ example: 'New York' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ example: 'NY' })
  @IsOptional()
  @IsString()
  state?: string;
}

export class CreateCheckoutSessionDto {
  @ApiProperty({
    type: [String],
    description: 'Polar product IDs to include in the checkout.',
    example: ['f47ac10b-58cc-4372-a567-0e02b2c3d479'],
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  products: string[];

  @ApiPropertyOptional({
    description: 'Redirect URL after successful checkout.',
    example: 'https://app.cropwatch.io/billing/success',
  })
  @IsOptional()
  @IsString()
  success_url?: string;

  @ApiPropertyOptional({
    description: 'URL to return to when customer leaves checkout.',
    example: 'https://app.cropwatch.io/billing',
  })
  @IsOptional()
  @IsString()
  return_url?: string;

  @ApiPropertyOptional({ example: 'Jane Smith' })
  @IsOptional()
  @IsString()
  customer_name?: string;

  @ApiPropertyOptional({ example: 'jane@example.com' })
  @IsOptional()
  @IsEmail()
  customer_email?: string;

  @ApiPropertyOptional({ type: () => CustomerBillingAddressDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CustomerBillingAddressDto)
  customer_billing_address?: CustomerBillingAddressDto;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: {
      oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }],
    },
    description: 'Metadata copied to order/subscription.',
    example: { plan: 'pro', seats: 5, trial: true },
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, string | number | boolean>;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: {
      oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }],
    },
    description: 'Metadata copied to customer when created.',
    example: { source: 'dashboard', region: 'us-east-1' },
  })
  @IsOptional()
  @IsObject()
  customer_metadata?: Record<string, string | number | boolean>;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  allow_discount_codes?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  allow_trial?: boolean;
}
