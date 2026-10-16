import { ApiProperty } from '@nestjs/swagger';
import { OVERVIEW_RANGES, type OverviewRange } from './overview-query.dto';

export const OVERVIEW_FEED_KINDS = [
  'alert_triggered',
  'alert_resolved',
  'device_offline',
  'device_online',
  'report',
  'data_hour',
  'data_day',
] as const;
export type OverviewFeedKind = (typeof OVERVIEW_FEED_KINDS)[number];

export class OverviewDevicesDto {
  @ApiProperty({ description: 'Devices the caller can view.' })
  total: number;

  @ApiProperty({
    description:
      'Heard within their upload interval (same rule as GET /v1/devices/status).',
  })
  online: number;

  @ApiProperty()
  offline: number;

  @ApiProperty({ nullable: true, format: 'date-time' })
  lastDataAt: string | null;

  @ApiProperty({ description: 'Distinct locations among those devices.' })
  locationCount: number;
}

export class OverviewGatewaysDto {
  @ApiProperty({
    description: 'Gateways GET /v1/gateway lists for the caller.',
  })
  total: number;

  @ApiProperty()
  online: number;
}

export class OverviewAlertDeviceDto {
  @ApiProperty()
  devEui: string;

  @ApiProperty({ nullable: true })
  deviceName: string | null;

  @ApiProperty({ nullable: true, type: Number })
  locationId: number | null;

  @ApiProperty({ nullable: true })
  locationName: string | null;

  @ApiProperty({ description: 'Alert episodes triggered in the range.' })
  count: number;
}

export class OverviewAlertsDto {
  @ApiProperty({ description: 'Alert episodes triggered in the range.' })
  count: number;

  @ApiProperty({
    description: 'Episodes triggered in the equally long period before it.',
  })
  previousCount: number;

  @ApiProperty({ description: 'Rule/device pairs triggered right now.' })
  active: number;

  @ApiProperty({
    type: [OverviewAlertDeviceDto],
    description:
      'The five devices with the most alerts in the range, most first.',
  })
  topDevices: OverviewAlertDeviceDto[];
}

export class OverviewReportDto {
  @ApiProperty()
  devEui: string;

  @ApiProperty({ nullable: true })
  deviceName: string | null;

  @ApiProperty({ nullable: true, type: Number })
  locationId: number | null;

  @ApiProperty({ nullable: true })
  locationName: string | null;

  @ApiProperty({
    description:
      'PDF name inside the device folder, `<YYYY_MM_DD>-<YYYY_MM_DD>.pdf`; download via GET /v1/reports/download/:dev_eui/:reportName.',
  })
  file: string;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;
}

export class OverviewReportsDto {
  @ApiProperty({ description: 'Report PDFs generated in the range.' })
  count: number;

  @ApiProperty({ nullable: true, format: 'date-time' })
  lastAt: string | null;

  @ApiProperty({
    type: () => OverviewReportDto,
    isArray: true,
    description: 'The newest four, regardless of range.',
  })
  recent: OverviewReportDto[];
}

export class OverviewUplinksDto {
  @ApiProperty({ description: 'Uplinks received in the range.' })
  count: number;

  @ApiProperty({
    description:
      'Uplinks counted toward expected: per device, capped at what its upload interval expects.',
  })
  delivered: number;

  @ApiProperty({
    description:
      'Uplinks the reporting devices were expected to send (range / upload interval, from each device’s first uplink in the range).',
  })
  expected: number;
}

export class OverviewHourDto {
  @ApiProperty({ format: 'date-time', description: 'Start of the UTC hour.' })
  hour: string;

  @ApiProperty({ description: 'Devices with at least one uplink that hour.' })
  reporting: number;
}

export class OverviewLocationDto {
  @ApiProperty({
    nullable: true,
    description: 'null = devices without a location.',
  })
  locationId: number | null;

  @ApiProperty({ nullable: true })
  name: string | null;

  @ApiProperty()
  total: number;

  @ApiProperty()
  online: number;

  @ApiProperty({ description: 'Alerts triggered in the range.' })
  alerts: number;
}

export class OverviewTypeDto {
  @ApiProperty({
    description:
      'cw_device_type.data_table_v2 (cw_air_data, cw_soil_data, cw_water_data, cw_traffic2, cw_relay_data).',
  })
  dataTable: string;

  @ApiProperty()
  total: number;
}

export class OverviewNoteDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  devEui: string;

  @ApiProperty({ nullable: true })
  deviceName: string | null;

  @ApiProperty({ nullable: true, type: Number })
  locationId: number | null;

  @ApiProperty({ nullable: true })
  locationName: string | null;

  @ApiProperty()
  title: string;

  @ApiProperty({ nullable: true })
  note: string | null;

  @ApiProperty({
    nullable: true,
    description:
      'Author email; null when a CropWatch staff member wrote it and the caller is not staff.',
  })
  author: string | null;

  @ApiProperty({ description: 'Written by CropWatch staff.' })
  authorIsStaff: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;
}

export class OverviewFeedItemDto {
  @ApiProperty({ enum: OVERVIEW_FEED_KINDS })
  kind: OverviewFeedKind;

  @ApiProperty({ format: 'date-time' })
  at: string;

  @ApiProperty({ required: false })
  devEui?: string;

  @ApiProperty({ required: false, nullable: true })
  deviceName?: string | null;

  @ApiProperty({
    required: false,
    nullable: true,
    type: Number,
    description: 'Items that name a device: its location, for linking.',
  })
  locationId?: number | null;

  @ApiProperty({ required: false, nullable: true })
  locationName?: string | null;

  @ApiProperty({ required: false, nullable: true, description: 'alert_*' })
  ruleName?: string | null;

  @ApiProperty({
    required: false,
    nullable: true,
    format: 'date-time',
    description: 'alert_resolved: when the episode started.',
  })
  triggeredAt?: string | null;

  @ApiProperty({
    required: false,
    nullable: true,
    format: 'date-time',
    description: 'device_*: the last uplink before the device went silent.',
  })
  lastSeenAt?: string | null;

  @ApiProperty({ required: false, description: 'report: the PDF name.' })
  file?: string;

  @ApiProperty({
    required: false,
    description: 'data_*: devices that sent data.',
  })
  reporting?: number;

  @ApiProperty({ required: false, description: 'data_*: devices in scope.' })
  total?: number;

  @ApiProperty({ required: false, description: 'data_day: uplinks that day.' })
  uplinks?: number;
}

export class OverviewFeedCountsDto {
  @ApiProperty({ description: 'Alerts triggered plus alerts resolved.' })
  alert: number;

  @ApiProperty()
  device: number;

  @ApiProperty()
  report: number;

  @ApiProperty()
  data: number;
}

export class OverviewFeedDto {
  @ApiProperty({ type: () => OverviewFeedCountsDto })
  counts: OverviewFeedCountsDto;

  @ApiProperty({
    type: () => OverviewFeedItemDto,
    isArray: true,
    description:
      'Newest first; up to 20 of each group (alerts, devices, reports, data), so every filter has items.',
  })
  items: OverviewFeedItemDto[];
}

export class OverviewAttentionGroupDto {
  @ApiProperty({ nullable: true })
  locationId: number | null;

  @ApiProperty({ nullable: true })
  name: string | null;

  @ApiProperty()
  count: number;
}

export class OverviewAttentionDto {
  @ApiProperty({ type: () => OverviewAttentionGroupDto, isArray: true })
  offline: OverviewAttentionGroupDto[];

  @ApiProperty({ type: () => OverviewAttentionGroupDto, isArray: true })
  activeAlerts: OverviewAttentionGroupDto[];
}

export class OverviewDto {
  @ApiProperty({ enum: OVERVIEW_RANGES })
  range: OverviewRange;

  @ApiProperty({ format: 'date-time' })
  generatedAt: string;

  @ApiProperty({ format: 'date-time', description: 'Start of the range.' })
  since: string;

  @ApiProperty({ type: () => OverviewDevicesDto })
  devices: OverviewDevicesDto;

  @ApiProperty({ type: () => OverviewGatewaysDto })
  gateways: OverviewGatewaysDto;

  @ApiProperty({ type: () => OverviewAlertsDto })
  alerts: OverviewAlertsDto;

  @ApiProperty({ type: () => OverviewReportsDto })
  reports: OverviewReportsDto;

  @ApiProperty({ type: () => OverviewUplinksDto })
  uplinks: OverviewUplinksDto;

  @ApiProperty({
    type: () => OverviewHourDto,
    isArray: true,
    description: 'The last 24 complete hours, oldest first (every range).',
  })
  hourly: OverviewHourDto[];

  @ApiProperty({ type: () => OverviewLocationDto, isArray: true })
  locations: OverviewLocationDto[];

  @ApiProperty({ type: () => OverviewTypeDto, isArray: true })
  types: OverviewTypeDto[];

  @ApiProperty({ type: () => OverviewNoteDto, isArray: true })
  notes: OverviewNoteDto[];

  @ApiProperty({ type: () => OverviewFeedDto })
  feed: OverviewFeedDto;

  @ApiProperty({ type: () => OverviewAttentionDto })
  attention: OverviewAttentionDto;
}
