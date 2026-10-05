import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import type { PostgrestError } from '@supabase/supabase-js';
import { SupabaseService } from '../../supabase/supabase.service';
import { AccessService, Action } from '../common/authz';
import type { TableRow } from '../types/supabase';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import type { GatewayDto } from './dto/gateway.dto';
import type {
  GatewayDeviceDto,
  GatewayDevicesResponseDto,
} from './dto/gateway-device.dto';
import type { DeviceGatewayDto } from './dto/device-gateway.dto';

/**
 * A device/gateway pair counts as "connected" when the device was heard
 * through the gateway within this many hours (cw_device_gateway.last_update).
 */
export const CONNECTED_WINDOW_HOURS = 24;

/** Max ids interpolated into one PostgREST `in` filter. */
const IN_CHUNK_SIZE = 100;
/** PostgREST page size (the project's max-rows default). */
const PAGE_SIZE = 1000;

type GatewayRow = TableRow<'cw_gateways'>;
type GatewayOwnerRow = TableRow<'cw_gateways_owners'>;
type GatewayRecord = GatewayRow & {
  cw_gateways_owners?: GatewayOwnerRow[];
};
type DeviceGatewayRow = Pick<
  TableRow<'cw_device_gateway'>,
  'dev_eui' | 'gateway_id' | 'rssi' | 'snr' | 'last_update'
>;
type QueryResult<T> = { data: T | null; error: PostgrestError | null };

function chunk<T>(items: readonly T[], size = IN_CHUNK_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function connectedSince(): string {
  return new Date(
    Date.now() - CONNECTED_WINDOW_HOURS * 60 * 60 * 1000,
  ).toISOString();
}

function byLastUpdateDesc(
  a: { last_update: string | null },
  b: { last_update: string | null },
): number {
  return (b.last_update ?? '').localeCompare(a.last_update ?? '');
}

@Injectable()
export class GatewayService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly accessService: AccessService,
  ) {}

  // -------------------------------------------------------------------------
  // Access helpers
  // -------------------------------------------------------------------------

  /**
   * Owner (cw_gateways_owners), the owning org's Owner/Managers, or staff.
   * `gateway.cw_gateways_owners` must be loaded for the owner check.
   */
  private canManageGateway(
    gateway: GatewayRecord,
    user: AuthenticatedUser,
    managedOrgIds: readonly string[],
  ): boolean {
    if (user.isStaff) return true;
    if (gateway.org_id != null && managedOrgIds.includes(gateway.org_id)) {
      return true;
    }
    return (gateway.cw_gateways_owners ?? []).some(
      (owner) => owner.user_id === user.sub,
    );
  }

  /** Anyone who can manage it, plus everyone for public gateways. */
  private canViewGateway(
    gateway: GatewayRecord,
    user: AuthenticatedUser,
    managedOrgIds: readonly string[],
  ): boolean {
    return (
      gateway.is_public || this.canManageGateway(gateway, user, managedOrgIds)
    );
  }

  /** Loads a gateway by its text id; 404 when missing or invisible. */
  private async findVisibleGateway(
    gatewayIdentifier: string,
    user: AuthenticatedUser,
  ): Promise<{ gateway: GatewayRecord; canManage: boolean }> {
    const normalized = gatewayIdentifier?.trim();
    if (!normalized) {
      throw new BadRequestException('gateway_id is required');
    }

    const client = this.supabaseService.getClient();
    const { data, error } = (await client
      .from('cw_gateways')
      .select('*, cw_gateways_owners(*)')
      .eq('gateway_id', normalized)
      .maybeSingle()) as QueryResult<GatewayRecord>;

    if (error) {
      throw new InternalServerErrorException('Failed to fetch gateway');
    }
    if (!data) {
      throw new NotFoundException('Gateway not found');
    }

    const managedOrgIds = await this.accessService.getManagedOrgIds(user);
    if (!this.canViewGateway(data, user, managedOrgIds)) {
      throw new NotFoundException('Gateway not found');
    }

    return {
      gateway: data,
      canManage: this.canManageGateway(data, user, managedOrgIds),
    };
  }

  // -------------------------------------------------------------------------
  // Batched enrichment
  // -------------------------------------------------------------------------

  /** Reads every page of a query (PostgREST caps responses at max-rows). */
  private async selectAllPages<T>(
    page: (from: number, to: number) => PromiseLike<QueryResult<T[]>>,
    errorMessage: string,
  ): Promise<T[]> {
    const rows: T[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await page(from, from + PAGE_SIZE - 1);
      if (error) {
        throw new InternalServerErrorException(errorMessage);
      }
      const batch = data ?? [];
      rows.push(...batch);
      if (batch.length < PAGE_SIZE) return rows;
    }
  }

  /**
   * Adds connected_device_count to gateway rows using a fixed number of
   * queries regardless of how many gateways.
   */
  private async enrich(
    rows: GatewayRecord[],
    includeOwners = false,
  ): Promise<GatewayDto[]> {
    if (rows.length === 0) return [];
    const client = this.supabaseService.getClient();

    // Distinct devices heard per gateway within the window.
    const since = connectedSince();
    const devicesByGateway = new Map<string, Set<string>>();
    for (const ids of chunk(rows.map((gw) => gw.gateway_id))) {
      const sightings = await this.selectAllPages<
        Pick<DeviceGatewayRow, 'dev_eui' | 'gateway_id'>
      >(
        (from, to) =>
          client
            .from('cw_device_gateway')
            .select('dev_eui, gateway_id')
            .in('gateway_id', ids)
            .gte('last_update', since)
            .order('id', { ascending: true })
            .range(from, to) as PromiseLike<
            QueryResult<Pick<DeviceGatewayRow, 'dev_eui' | 'gateway_id'>[]>
          >,
        'Failed to fetch gateway devices',
      );
      for (const row of sightings) {
        let set = devicesByGateway.get(row.gateway_id);
        if (!set) {
          set = new Set();
          devicesByGateway.set(row.gateway_id, set);
        }
        set.add(row.dev_eui);
      }
    }

    return rows.map((gw) => {
      const { cw_gateways_owners, ...base } = gw;
      return {
        ...base,
        ...(includeOwners && cw_gateways_owners ? { cw_gateways_owners } : {}),
        connected_device_count: devicesByGateway.get(gw.gateway_id)?.size ?? 0,
      };
    });
  }

  // -------------------------------------------------------------------------
  // Endpoints
  // -------------------------------------------------------------------------

  async findAll(user: AuthenticatedUser): Promise<GatewayDto[]> {
    const client = this.supabaseService.getClient();
    const managedOrgIds = user.isStaff
      ? []
      : await this.accessService.getManagedOrgIds(user);
    // Staff bypass scoping, like every other resource in the API.
    if (user.isStaff) {
      const { data, error } = (await client
        .from('cw_gateways')
        .select('*')) as QueryResult<GatewayRow[]>;
      if (error) {
        throw new InternalServerErrorException('Failed to fetch gateways');
      }
      return this.enrich(data ?? []);
    }

    // Org overlay: the org's Owner and Managers see the org's gateways.
    const orgRows: GatewayRow[] = [];
    if (managedOrgIds.length > 0) {
      const { data: orgGateways, error: orgGatewaysError } = (await client
        .from('cw_gateways')
        .select('*')
        .in('org_id', managedOrgIds)) as QueryResult<GatewayRow[]>;
      if (orgGatewaysError) {
        throw new InternalServerErrorException('Failed to fetch gateways');
      }
      orgRows.push(...(orgGateways ?? []));
    }

    const { data: ownedGateways, error: ownedGatewaysError } = (await client
      .from('cw_gateways')
      .select('*, cw_gateways_owners!inner(*)')
      .eq('cw_gateways_owners.user_id', user.sub)) as QueryResult<
      GatewayRecord[]
    >;

    const { data: publicGateways, error: publicGatewaysError } = (await client
      .from('cw_gateways')
      .select('*')
      .eq('is_public', true)) as QueryResult<GatewayRow[]>;

    if (ownedGatewaysError || publicGatewaysError) {
      throw new InternalServerErrorException('Failed to fetch gateways');
    }

    // Org rows first, then owned, then public ones not already listed.
    const seen = new Set<string>();
    const listed: GatewayRecord[] = [];
    for (const gw of [
      ...orgRows,
      ...(ownedGateways ?? []),
      ...(publicGateways ?? []),
    ] as GatewayRecord[]) {
      if (seen.has(gw.gateway_id)) continue;
      seen.add(gw.gateway_id);
      listed.push(gw);
    }

    return this.enrich(listed);
  }

  async findOne(
    gatewayIdentifier: string,
    user: AuthenticatedUser,
  ): Promise<GatewayDto> {
    const { gateway, canManage } = await this.findVisibleGateway(
      gatewayIdentifier,
      user,
    );
    // Owner rows carry other users' ids: only for callers who manage the
    // gateway, not for everyone who can see a public one.
    const [dto] = await this.enrich([gateway], canManage);
    return dto;
  }

  /**
   * Gateways that heard a device (all time, newest first). Gateways the
   * caller cannot view — or that are not registered in cw_gateways — are
   * anonymized.
   */
  async findByDevice(
    devEui: string,
    user: AuthenticatedUser,
  ): Promise<DeviceGatewayDto[]> {
    const access = await this.accessService.assertDeviceAccess(
      user,
      devEui,
      Action.DeviceRead,
    );
    const client = this.supabaseService.getClient();

    const { data: sightings, error } = (await client
      .from('cw_device_gateway')
      .select('dev_eui, gateway_id, rssi, snr, last_update')
      .eq('dev_eui', access.devEui)
      .order('last_update', { ascending: false })) as QueryResult<
      DeviceGatewayRow[]
    >;
    if (error) {
      throw new InternalServerErrorException('Failed to fetch device gateways');
    }
    const rows = sightings ?? [];
    if (rows.length === 0) return [];

    const gatewaysById = new Map<string, GatewayRecord>();
    for (const ids of chunk([...new Set(rows.map((r) => r.gateway_id))])) {
      const { data, error: gwError } = (await client
        .from('cw_gateways')
        .select('*, cw_gateways_owners(*)')
        .in('gateway_id', ids)) as QueryResult<GatewayRecord[]>;
      if (gwError) {
        throw new InternalServerErrorException('Failed to fetch gateways');
      }
      for (const gw of data ?? []) gatewaysById.set(gw.gateway_id, gw);
    }

    const managedOrgIds = user.isStaff
      ? []
      : await this.accessService.getManagedOrgIds(user);

    return rows
      .map((row): DeviceGatewayDto => {
        const gw = gatewaysById.get(row.gateway_id);
        const signal = {
          rssi: row.rssi,
          snr: row.snr,
          last_update: row.last_update ?? null,
        };
        if (!gw || !this.canViewGateway(gw, user, managedOrgIds)) {
          return {
            anonymized: true,
            gateway_id: null,
            gateway_name: null,
            is_online: null,
            ...signal,
          };
        }
        return {
          anonymized: false,
          gateway_id: gw.gateway_id,
          gateway_name: gw.gateway_name,
          is_online: gw.is_online,
          ...signal,
        };
      })
      .sort(byLastUpdateDesc);
  }

  /**
   * Devices heard through a gateway within the connected window. Only
   * devices the caller can read are listed; the rest are counted.
   */
  async findDevices(
    gatewayIdentifier: string,
    user: AuthenticatedUser,
  ): Promise<GatewayDevicesResponseDto> {
    const { gateway } = await this.findVisibleGateway(gatewayIdentifier, user);
    const client = this.supabaseService.getClient();
    const since = connectedSince();

    const sightings = await this.selectAllPages<DeviceGatewayRow>(
      (from, to) =>
        client
          .from('cw_device_gateway')
          .select('dev_eui, gateway_id, rssi, snr, last_update')
          .eq('gateway_id', gateway.gateway_id)
          .gte('last_update', since)
          .order('id', { ascending: true })
          .range(from, to) as PromiseLike<QueryResult<DeviceGatewayRow[]>>,
      'Failed to fetch gateway devices',
    );

    const accessible = await this.accessService.listAccessibleDevices(user);
    const readable = new Map(
      accessible.filter((d) => d.canView).map((d) => [d.devEui, d]),
    );

    const visible = sightings.filter((row) => readable.has(row.dev_eui));
    const otherDeviceCount = sightings.length - visible.length;

    const deviceLocations = new Map<
      string,
      { location_id: number | null; location_name: string | null }
    >();
    for (const ids of chunk([...new Set(visible.map((r) => r.dev_eui))])) {
      const { data, error } = (await client
        .from('cw_devices')
        .select('dev_eui, location_id, cw_locations(name)')
        .in('dev_eui', ids)) as QueryResult<
        {
          dev_eui: string;
          location_id: number | null;
          cw_locations: { name: string } | null;
        }[]
      >;
      if (error) {
        throw new InternalServerErrorException('Failed to fetch devices');
      }
      for (const row of data ?? []) {
        deviceLocations.set(row.dev_eui, {
          location_id: row.location_id,
          location_name: row.cw_locations?.name ?? null,
        });
      }
    }

    const devices = visible
      .map(
        (row): GatewayDeviceDto => ({
          dev_eui: row.dev_eui,
          name: readable.get(row.dev_eui)?.name ?? null,
          location_id: deviceLocations.get(row.dev_eui)?.location_id ?? null,
          location_name:
            deviceLocations.get(row.dev_eui)?.location_name ?? null,
          rssi: row.rssi,
          snr: row.snr,
          last_update: row.last_update ?? null,
        }),
      )
      .sort(byLastUpdateDesc);

    return { devices, other_device_count: otherDeviceCount };
  }
}
