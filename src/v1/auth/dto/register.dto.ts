import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'John', description: 'First name of the user' })
  @IsString()
  @IsNotEmpty({ message: 'First name is required' })
  firstName: string;

  @ApiProperty({ example: 'Doe', description: 'Last name of the user' })
  @IsString()
  @IsNotEmpty({ message: 'Last name is required' })
  lastName: string;

  @ApiProperty({
    example: 'user@example.com',
    description: 'Email address of the user',
  })
  @IsEmail({}, { message: 'A valid email address is required' })
  @IsNotEmpty({ message: 'Email is required' })
  email: string;

  @ApiProperty({
    example: 'StrongPassword123!',
    description:
      'Password must be at least 8 characters and contain uppercase, lowercase, number, and symbol',
  })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @Matches(/(?=.*[a-z])/, {
    message: 'Password must contain at least one lowercase letter',
  })
  @Matches(/(?=.*[A-Z])/, {
    message: 'Password must contain at least one uppercase letter',
  })
  @Matches(/(?=.*\d)/, {
    message: 'Password must contain at least one number',
  })
  @Matches(/(?=.*[!@#$%^&*(),.?":{}|<>])/, {
    message: 'Password must contain at least one symbol',
  })
  password: string;

  @ApiProperty({
    example: 'CropWatch Inc.',
    description: 'Company name of the user',
  })
  @IsString()
  @IsNotEmpty({ message: 'Company name is required' })
  companyName: string;

  @ApiProperty({
    example: true,
    description: 'User has accepted the Terms of Service (EULA)',
  })
  @IsBoolean()
  acceptedTerms: boolean;

  @ApiProperty({
    example: true,
    description: 'User has accepted the Privacy Policy',
  })
  @IsBoolean()
  acceptedPrivacyPolicy: boolean;

  @ApiProperty({
    example: true,
    description: 'User has accepted the Cookie Policy',
  })
  @IsBoolean()
  acceptedCookiePolicy: boolean;
}

export class RegisterResponseDto {
  @ApiProperty({ example: 'Registration successful.' })
  message: string;

  @ApiProperty({ type: 'object', additionalProperties: true })
  result: Record<string, unknown>;
}
