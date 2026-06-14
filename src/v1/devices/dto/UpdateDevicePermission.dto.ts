import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEmail, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';
import { MAX_PERMISSION_LEVEL, MIN_PERMISSION_LEVEL } from '../../common/permission-levels';

export class UpdateDevicePermissionDto {
    @ApiProperty({ example: 'user@example.com', type: 'string', required: true })
    @IsEmail()
    targetUserEmail: string;

    // Accept the current UI payload shape even though dev_eui is sourced from the route param.
    @IsOptional()
    @IsString()
    @IsNotEmpty()
    dev_eui?: string;

    @ApiProperty({ example: 2, type: Number, required: true })
    @Type(() => Number)
    @IsInt()
    @Min(MIN_PERMISSION_LEVEL)
    @Max(MAX_PERMISSION_LEVEL)
    permissionLevel: number;
}
