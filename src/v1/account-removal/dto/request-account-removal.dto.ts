import {
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class RequestAccountRemovalDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  message?: string;

  @Type(() => Number)
  @IsInt()
  answer!: number;

  @IsString()
  @MaxLength(120)
  token!: string;
}
