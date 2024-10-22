// User Auth DTO
import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsEmail } from 'class-validator';

export class UserAuthDto {
  @ApiProperty({ description: 'JWT authentication token' })
  @IsString()
  token: string;
}

export class LoginDto {
  @ApiProperty({ description: 'User email address' })
  @IsEmail()
  email: string;

  @ApiProperty({ description: 'User password' })
  @IsString()
  password: string;
}