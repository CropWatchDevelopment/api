import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class RefreshPushTokenDto {
  @ApiProperty({ description: "This browser's current FCM registration token" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  token: string;

  @ApiProperty({
    required: false,
    description:
      'The token this browser had before, when Firebase has issued a new one',
  })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  previousToken?: string;

  @ApiProperty({
    required: false,
    description: 'Human-readable label for the enrolled device',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  deviceLabel?: string;
}
