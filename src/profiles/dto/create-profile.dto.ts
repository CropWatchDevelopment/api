import { IsBoolean, IsEmail, IsNotEmpty, IsOptional, IsString, IsUrl } from 'class-validator';

export class CreateProfileDto {
  @IsNotEmpty()
  @IsString()
  id: string;

  @IsOptional()
  @IsBoolean()
  accepted_agreements?: boolean;

  @IsOptional()
  @IsString()
  @IsUrl()
  avatar_url?: string | null;

  @IsOptional()
  @IsEmail()
  email?: string | null;

  @IsOptional()
  @IsString()
  employer?: string | null;

  @IsOptional()
  @IsString()
  full_name?: string | null;

  @IsOptional()
  @IsString()
  last_login?: string | null;

  @IsOptional()
  @IsString()
  line_notify_token?: string | null;

  @IsOptional()
  @IsString()
  updated_at?: string | null;

  @IsOptional()
  @IsString()
  username?: string | null;

  @IsOptional()
  @IsUrl()
  website?: string | null;
}
