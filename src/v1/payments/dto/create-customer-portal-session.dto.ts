import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class CreateCustomerPortalSessionDto {
  @ApiPropertyOptional({
    description: 'Optional return URL after managing subscriptions in the customer portal.',
    example: 'https://app.cropwatch.io/billing',
  })
  @IsOptional()
  @IsString()
  return_url?: string;
}
