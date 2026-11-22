import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';

/** Longest group name the group endpoints accept. */
export const GROUP_NAME_MAX_LENGTH = 120;

/** A device or location group the caller can see. */
export class GroupDto {
  @ApiProperty({ example: 12 })
  id: number;

  @ApiProperty({ example: 'Greenhouse A' })
  name: string;

  @ApiProperty({
    format: 'uuid',
    nullable: true,
    description:
      'The organization the group belongs to: its locations/devices use it (one group per name per organization).',
  })
  org_id: string | null;

  @ApiProperty({
    description:
      'Whether the caller may rename or delete the group: the organization’s owner and managers, CropWatch staff, and its creator can.',
  })
  can_manage: boolean;
}

/** Body of the rename call. */
export class GroupNameDto {
  @ApiProperty({ example: 'Greenhouse A', maxLength: GROUP_NAME_MAX_LENGTH })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(GROUP_NAME_MAX_LENGTH)
  name: string;
}

/** Body of the create call. */
export class CreateGroupDto extends GroupNameDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'The organization to add the group to: the one whose locations/devices will use it.',
  })
  @IsUUID()
  org_id: string;
}
