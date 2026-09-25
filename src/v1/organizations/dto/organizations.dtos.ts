import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export class UpdateOrgDto {
  @ApiProperty({ description: 'Organization display name (1-120 chars)' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;
}

export class LocationGrantDto {
  @ApiProperty({ description: 'A location belonging to the organization' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  location_id: number;

  @ApiProperty({
    description:
      'Default device role for the location: 3 User, 4 Viewer, 5 revoked',
  })
  @Type(() => Number)
  @IsInt()
  @IsIn([3, 4, 5])
  default_role: number;
}

export class CreateInviteDto {
  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiProperty({ enum: ['manager', 'member', 'guest'] })
  @IsIn(['manager', 'member', 'guest'])
  role: 'manager' | 'member' | 'guest';

  @ApiProperty({ type: [LocationGrantDto], required: false })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => LocationGrantDto)
  location_grants?: LocationGrantDto[];

  @ApiProperty({
    required: false,
    description: 'Optional guest access expiry (guests only, no default)',
  })
  @IsOptional()
  @IsISO8601()
  member_expires_at?: string;
}

export class UpdateMemberDto {
  @ApiProperty({
    required: false,
    enum: ['manager', 'member'],
    description: 'New role; owner-only for promotions and manager targets',
  })
  @IsOptional()
  @IsIn(['manager', 'member'])
  role?: 'manager' | 'member';

  @ApiProperty({ type: [LocationGrantDto], required: false })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => LocationGrantDto)
  location_grants?: LocationGrantDto[];
}

export class CreateLinkRequestDto {
  @ApiProperty({ description: 'The child organization id' })
  @IsUUID()
  child_org_id: string;
}

// ---------------------------------------------------------------------------
// Staff admin
// ---------------------------------------------------------------------------

export class AdminConvertOrgDto {
  @ApiProperty({ description: 'Company display name' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;
}

export class AdminTransferOwnershipDto {
  @ApiProperty({ description: 'The new owner (must be an active full member)' })
  @IsUUID()
  new_owner_user_id: string;
}

export class AdminLinkOrgsDto {
  @ApiProperty()
  @IsUUID()
  parent_org_id: string;

  @ApiProperty()
  @IsUUID()
  child_org_id: string;
}

export class AdminSearchOrgsQueryDto {
  @ApiProperty({ required: false, description: 'Name or member email filter' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  include_deactivated?: boolean;
}
