import { ApiProperty } from "@nestjs/swagger";

export class IRuleCountDto {
    @ApiProperty()
    triggered_count: Number;
    @ApiProperty()
    total_count: Number;
}