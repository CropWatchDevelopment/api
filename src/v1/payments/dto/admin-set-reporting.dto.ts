import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class AdminSetReportingDto {
  @ApiProperty({
    description:
      'Grant (true) or revoke (false) the staff-granted reporting entitlement. Independent of any Stripe reporting subscription.',
  })
  @IsBoolean()
  manual: boolean;
}
