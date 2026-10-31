import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

// Separators (space, colon, dash) are accepted and stripped by the service.
const EUI_INPUT = /^[0-9a-fA-F:\-\s]{16,23}$/;

export class GatewayClaimDto {
  @ApiProperty({
    example: '647FDAFFFE02D202',
    description: 'Gateway EUI; spaces, colons and dashes are ignored.',
  })
  @IsString()
  @Matches(EUI_INPUT, {
    message: 'gateway_eui must be 16 hexadecimal characters',
  })
  gateway_eui: string;

  @ApiPropertyOptional({
    example: 'info@example.com',
    description:
      'Staff only: the account to add the gateway to. Defaults to the caller.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() || undefined : value,
  )
  @IsEmail()
  @MaxLength(254)
  user_email?: string;
}

export class GatewayClaimResultDto {
  @ApiProperty({ description: 'cw_gateways.gateway_id' })
  gateway_id: string;

  @ApiProperty({ description: 'Gateway display name.' })
  gateway_name: string;

  @ApiProperty({
    description:
      'False when the account could already see the gateway; nothing was changed.',
  })
  added: boolean;
}
