import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsEmail, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';
import { Database } from '../../../../database.types';

type LocationOwnerInsert = Database['public']['Tables']['cw_location_owners']['Insert'];

export class CreateLocationOwnerDto implements LocationOwnerInsert {
  @ApiProperty()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  admin_user_id: string;

  @ApiProperty()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  location_id: number;

  @ApiProperty()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  user_id: string;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  description?: string | null;

  @ApiProperty({ required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  id?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsEmail()
  user_email?: string; // This field is not part of the database schema but will be used to look up the user ID based on the provided email when creating a new location owner record.

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean | null;

  @ApiProperty({ required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  owner_id?: number;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(4)
  permission_level?: number | null;

  @IsOptional()
  @IsBoolean()
  applyToAllDevices?: boolean;
}
