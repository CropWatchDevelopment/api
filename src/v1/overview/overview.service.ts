import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import type { PostgrestError } from '@supabase/supabase-js';
import { SupabaseService } from '../../supabase/supabase.service';
import { AccessService } from '../common/authz';
import { isStaffEmail } from '../common/owner-filter.helper';
import { GatewayService } from '../gateway/gateway.service';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import {
  OVERVIEW_RANGE_HOURS,
  type OverviewRange,
} from './dto/overview-query.dto';
import type {
  OverviewAttentionGroupDto,
  OverviewDto,
  OverviewFeedItemDto,
  OverviewFeedKind,
} from './dto/overview.dto';

/** Feed items per group (alerts, devices, reports, data) — cw_overview p_feed_limit. */
export const OVERVIEW_FEED_LIMIT = 20;

/** Location group as cw_overview returns it. */
interface RpcGroup {
  location_id: number | null;
  name: string | null;
  count: number;
}

/**
 * The jsonb object returned by cw_overview (033_overview.sql; location ids and
 * alerts.top_devices since 035_overview_links.sql, so optional here). It also
 * still returns devices.low_battery / low_battery_online and
 * attention.low_battery, which are not read: no device has a battery sensor.
 * TODO: drop them from cw_overview in the next SQL update.
 */
export interface OverviewRpcResult {
  generated_at: string;
  since: string;
  devices: {
    total: number;
    online: number;
    offline: number;
    last_data_at: string | null;
    location_count: number;
  };
  locations: {
    location_id: number | null;
    name: string | null;
    total: number;
    online: number;
    alerts: number;
  }[];
  types: { data_table: string; total: number }[];
  alerts: {
    count: number;
    previous_count: number;
    active: number;
    top_devices?: {
      dev_eui: string;
      device_name: string | null;
      location_id: number | null;
      location_name: string | null;
      count: number;
    }[];
  };
  reports: {
    count: number;
    last_at: string | null;
    recent: {
      dev_eui: string;
      device_name: string | null;
      location_id?: number | null;
      location_name: string | null;
      file: string;
      created_at: string;
    }[];
  };
  uplinks: { count: number; delivered: number; expected: number };
  hourly: { hour: string; reporting: number }[];
  notes: {
    id: number;
    dev_eui: string;
    device_name: string | null;
    location_id?: number | null;
    location_name: string | null;
    title: string;
    note: string | null;
    created_by: string | null;
    created_at: string;
  }[];
  feed: {
    counts: { alert: number; device: number; report: number; data: number };
    items: {
      kind: OverviewFeedKind;
      at: string;
      dev_eui?: string;
      device_name?: string | null;
      location_id?: number | null;
      location_name?: string | null;
      rule_name?: string | null;
      triggered_at?: string | null;
      last_seen_at?: string | null;
      file?: string;
      reporting?: number;
      total?: number;
      uplinks?: number;
    }[];
  };
  attention: {
    offline: RpcGroup[];
    active_alerts: RpcGroup[];
  };
}

function toGroups(groups: RpcGroup[]): OverviewAttentionGroupDto[] {
  return groups.map((group) => ({
    locationId: group.location_id,
    name: group.name,
    count: group.count,
  }));
}

/**
 * Maps the cw_overview payload to the API shape. Staff note authors are
 * hidden from customers (only @cropwatch.io callers may see staff).
 */
export function toOverviewDto(
  rpc: OverviewRpcResult,
  context: {
    range: OverviewRange;
    gateways: { is_online: boolean }[];
    user: AuthenticatedUser;
  },
): OverviewDto {
  return {
    range: context.range,
    generatedAt: rpc.generated_at,
    since: rpc.since,
    devices: {
      total: rpc.devices.total,
      online: rpc.devices.online,
      offline: rpc.devices.offline,
      lastDataAt: rpc.devices.last_data_at,
      locationCount: rpc.devices.location_count,
    },
    gateways: {
      total: context.gateways.length,
      online: context.gateways.filter((gateway) => gateway.is_online).length,
    },
    alerts: {
      count: rpc.alerts.count,
      previousCount: rpc.alerts.previous_count,
      active: rpc.alerts.active,
      topDevices: (rpc.alerts.top_devices ?? []).map((device) => ({
        devEui: device.dev_eui,
        deviceName: device.device_name,
        locationId: device.location_id,
        locationName: device.location_name,
        count: device.count,
      })),
    },
    reports: {
      count: rpc.reports.count,
      lastAt: rpc.reports.last_at,
      recent: rpc.reports.recent.map((report) => ({
        devEui: report.dev_eui,
        deviceName: report.device_name,
        locationId: report.location_id ?? null,
        locationName: report.location_name,
        file: report.file,
        createdAt: report.created_at,
      })),
    },
    uplinks: { ...rpc.uplinks },
    hourly: rpc.hourly.map((hour) => ({
      hour: hour.hour,
      reporting: hour.reporting,
    })),
    locations: rpc.locations.map((location) => ({
      locationId: location.location_id,
      name: location.name,
      total: location.total,
      online: location.online,
      alerts: location.alerts,
    })),
    types: rpc.types.map((type) => ({
      dataTable: type.data_table,
      total: type.total,
    })),
    notes: rpc.notes.map((note) => {
      const authorIsStaff = isStaffEmail(note.created_by);
      return {
        id: note.id,
        devEui: note.dev_eui,
        deviceName: note.device_name,
        locationId: note.location_id ?? null,
        locationName: note.location_name,
        title: note.title,
        note: note.note,
        author:
          authorIsStaff && !context.user.isStaff
            ? null
            : (note.created_by?.trim() ?? null) || null,
        authorIsStaff,
        createdAt: note.created_at,
      };
    }),
    feed: {
      counts: { ...rpc.feed.counts },
      items: rpc.feed.items.map((item) => {
        const dto: OverviewFeedItemDto = { kind: item.kind, at: item.at };
        if (item.dev_eui !== undefined) dto.devEui = item.dev_eui;
        if (item.device_name !== undefined) dto.deviceName = item.device_name;
        if (item.location_id !== undefined) dto.locationId = item.location_id;
        if (item.location_name !== undefined) {
          dto.locationName = item.location_name;
        }
        if (item.rule_name !== undefined) dto.ruleName = item.rule_name;
        if (item.triggered_at !== undefined) {
          dto.triggeredAt = item.triggered_at;
        }
        if (item.last_seen_at !== undefined) {
          dto.lastSeenAt = item.last_seen_at;
        }
        if (item.file !== undefined) dto.file = item.file;
        if (item.reporting !== undefined) dto.reporting = item.reporting;
        if (item.total !== undefined) dto.total = item.total;
        if (item.uplinks !== undefined) dto.uplinks = item.uplinks;
        return dto;
      }),
    },
    attention: {
      offline: toGroups(rpc.attention.offline),
      activeAlerts: toGroups(rpc.attention.active_alerts),
    },
  };
}

@Injectable()
export class OverviewService {
  private readonly logger = new Logger(OverviewService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly accessService: AccessService,
    private readonly gatewayService: GatewayService,
  ) {}

  /**
   * Everything the overview page shows, in one database call: the caller's
   * readable devices are resolved here (the access model lives in the API)
   * and cw_overview aggregates over them — it never reads telemetry tables.
   */
  async getOverview(
    user: AuthenticatedUser,
    range: OverviewRange,
  ): Promise<OverviewDto> {
    const [devices, gateways] = await Promise.all([
      this.accessService.listAccessibleDevices(user),
      this.gatewayService.listVisible(user),
    ]);
    const devEuis = devices
      .filter((device) => device.canView)
      .map((device) => device.devEui);

    const { data, error } = (await this.supabaseService
      .getClient()
      .rpc('cw_overview', {
        p_dev_euis: devEuis,
        p_hours: OVERVIEW_RANGE_HOURS[range],
        p_feed_limit: OVERVIEW_FEED_LIMIT,
      })) as { data: OverviewRpcResult | null; error: PostgrestError | null };

    if (error || !data) {
      this.logger.error(
        `cw_overview failed: ${error?.message ?? 'no data'} (${error?.code ?? '-'})`,
      );
      throw new InternalServerErrorException('Failed to load overview');
    }

    return toOverviewDto(data, { range, gateways, user });
  }
}
