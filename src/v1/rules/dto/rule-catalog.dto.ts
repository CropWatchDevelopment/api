import { ApiProperty } from '@nestjs/swagger';

export class RuleCatalogDeviceDto {
  @ApiProperty()
  devEui: string;

  @ApiProperty({ nullable: true })
  name: string | null;
}

export class RuleCatalogEntryDto {
  @ApiProperty()
  templateId: number;

  @ApiProperty()
  name: string;

  @ApiProperty({ type: RuleCatalogDeviceDto, isArray: true })
  devices: RuleCatalogDeviceDto[];
}

export class RuleCatalogDto {
  @ApiProperty({
    type: RuleCatalogEntryDto,
    isArray: true,
    description:
      'Active rule templates the caller can see, each with its assigned devices. Trimmed for low-power clients — no criteria, actions, or state.',
  })
  rules: RuleCatalogEntryDto[];
}
