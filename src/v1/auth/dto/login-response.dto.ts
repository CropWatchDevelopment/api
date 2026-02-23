import { ApiProperty } from '@nestjs/swagger';

export class LoginResponseDto {
  @ApiProperty({ example: 'Login successful.' })
  message: string;

  @ApiProperty({ type: 'object', additionalProperties: true })
  data: Record<string, unknown>;
}
