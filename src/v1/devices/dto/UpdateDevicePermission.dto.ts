import { ApiProperty } from '@nestjs/swagger';

export class UpdateDevicePermissionDto {
    @ApiProperty({ example: 'user@example.com', type: 'string', required: true })
    targetUserEmail: string;

    @ApiProperty({ example: 2, type: Number, required: true })
    permissionLevel: number;
}