import { IsNotEmpty, IsNumber, IsString } from 'class-validator';

export class BaseDeviceDto {
    @IsNotEmpty()
    @IsString()
    dev_eui: string;

    @IsNotEmpty()
    @IsString()
    name: string;

    @IsNotEmpty()
    @IsNumber()
    type: number;
}