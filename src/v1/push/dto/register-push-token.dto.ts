import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class RegisterPushTokenDto {
  @ApiProperty({ description: 'FCM registration token for this device' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  token: string;

  @ApiProperty({
    required: false,
    description: 'Human-readable label for the enrolled device',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  deviceLabel?: string;
}
