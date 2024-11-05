import { IsNotEmpty, IsString } from 'class-validator';

export class BaseDevEuiDto {
    @IsNotEmpty()
    @IsString()
    dev_eui: string;
}