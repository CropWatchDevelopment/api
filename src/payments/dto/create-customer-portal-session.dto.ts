import { ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCustomerPortalSessionDto {
  @ApiPropertyOptional({
    description: 'Optional return URL after managing subscriptions in the customer portal.',
    example: 'https://app.cropwatch.io/billing',
  })
  return_url?: string;
}
