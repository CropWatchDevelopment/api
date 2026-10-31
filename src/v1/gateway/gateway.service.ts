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
import type {
  GatewayClaimDto,
  GatewayClaimResultDto,
} from './dto/gateway-claim.dto';
import { GatewayClaimException } from './gateway-claim.errors';

/**
 * A device/gateway pair counts as "connected" when the device was heard
 * through the gateway within this many hours (cw_device_gateway.last_update).
 */
export const CONNECTED_WINDOW_HOURS = 24;

/**
 * A customer may add an unclaimed gateway only if it heard one of their
 * devices within this many days: proof they are near it, since EUIs come in
 * guessable sequential batches.
 */
export const CLAIM_PROOF_WINDOW_DAYS = 7;

const HEX16 = /^[0-9A-F]{16}$/;

/** Max ids interpolated into one PostgREST `in` filter. */
const IN_CHUNK_SIZE = 100;
/** PostgREST page size (the project's max-rows default). */
const PAGE_SIZE = 1000;

type GatewayRow = TableRow<'cw_gateways'>;
type GatewayOwnerRow = TableRow<'cw_gateways_owners'>;
export type GatewayRecord = GatewayRow & {
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
    return this.enrich(await this.listVisible(user));
  }

  /**
   * The gateways GET /v1/gateway lists for the caller, without enrichment:
   * staff see every gateway; others see their org's (as Owner/Manager),
   * their own (cw_gateways_owners) and public ones.
   */
  async listVisible(user: AuthenticatedUser): Promise<GatewayRecord[]> {
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
      return data ?? [];
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

    return listed;
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

  /**
   * Adds a gateway to an account by its EUI (a cw_gateways_owners row; the
   * org_claim_gateway trigger then claims an unclaimed gateway for that
   * account's org). Staff may add any gateway to any account. Customers may
   * add only an unclaimed gateway that heard one of the devices they manage
   * within CLAIM_PROOF_WINDOW_DAYS.
   */
  async claim(
    user: AuthenticatedUser,
    dto: GatewayClaimDto,
  ): Promise<GatewayClaimResultDto> {
    const eui = dto.gateway_eui.replace(/[\s:-]/g, '').toUpperCase();
    if (!HEX16.test(eui)) {
      throw new GatewayClaimException(
        'INVALID_EUI',
        'The gateway EUI must be 16 hexadecimal characters.',
      );
    }

    const targetUserId = await this.claimTarget(user, dto.user_email);
    const gateway = await this.findGatewayByEui(eui);
    const result = (added: boolean): GatewayClaimResultDto => ({
      gateway_id: gateway.gateway_id,
      gateway_name: gateway.gateway_name,
      added,
    });

    const owners = gateway.cw_gateways_owners ?? [];
    if (owners.some((owner) => owner.user_id === targetUserId)) {
      return result(false);
    }

    if (!user.isStaff) {
      const managedOrgIds = await this.accessService.getManagedOrgIds(user);
      if (gateway.org_id != null && managedOrgIds.includes(gateway.org_id)) {
        return result(false);
      }
      if (gateway.org_id != null || owners.length > 0) {
        throw new GatewayClaimException(
          'GATEWAY_CLAIMED',
          'This gateway already belongs to another account.',
        );
      }
      if (!(await this.heardManagedDevice(user, gateway.gateway_id))) {
        throw new GatewayClaimException(
          'GATEWAY_NOT_HEARD',
          `This gateway has not heard any of your devices in the last ${CLAIM_PROOF_WINDOW_DAYS} days.`,
        );
      }
    }

    // Two customers adding the same unclaimed gateway at the same moment can
    // both get an owner row; the org goes to the first insert. Both have
    // devices it hears, so staff can sort that out by hand.
    const { error } = await this.supabaseService
      .getClient()
      .from('cw_gateways_owners')
      .insert({
        gateway_id: gateway.id,
        user_id: targetUserId,
        gateway_eui: gateway.gateway_id,
      });
    if (error) {
      throw new InternalServerErrorException('Failed to add gateway');
    }
    return result(true);
  }

  /** The caller, or (staff only) the account with `email`. */
  private async claimTarget(
    user: AuthenticatedUser,
    email: string | undefined,
  ): Promise<string> {
    if (!email) return user.sub;
    if (!user.isStaff) {
      throw new GatewayClaimException(
        'STAFF_ONLY',
        'Only staff can add a gateway to another account.',
      );
    }
    // Case-insensitive exact match: escape ILIKE's wildcards.
    const { data, error } = (await this.supabaseService
      .getClient()
      .from('profiles')
      .select('id')
      .ilike('email', email.replace(/[\\%_]/g, '\\$&'))
      .maybeSingle()) as QueryResult<{ id: string }>;
    if (error) {
      throw new InternalServerErrorException('Failed to fetch user');
    }
    if (!data) {
      throw new GatewayClaimException(
        'USER_NOT_FOUND',
        'No account uses that email address.',
      );
    }
    return data.id;
  }

  /**
   * The one gateway whose id contains the EUI (ids are `eui-<eui>`, with a
   * few legacy prefixes and suffixes).
   */
  private async findGatewayByEui(eui: string): Promise<GatewayRecord> {
    const { data, error } = (await this.supabaseService
      .getClient()
      .from('cw_gateways')
      .select('*, cw_gateways_owners(*)')
      .ilike('gateway_id', `%${eui}%`)) as QueryResult<GatewayRecord[]>;
    if (error) {
      throw new InternalServerErrorException('Failed to fetch gateway');
    }
    const matches = data ?? [];
    if (matches.length === 0) {
      throw new GatewayClaimException(
        'GATEWAY_NOT_FOUND',
        'No gateway with that EUI is connected to CropWatch.',
      );
    }
    if (matches.length > 1) {
      throw new GatewayClaimException(
        'GATEWAY_AMBIGUOUS',
        'More than one gateway matches that EUI. Please contact support.',
      );
    }
    return matches[0];
  }

  /** Whether the gateway heard a device the caller manages within the proof window. */
  private async heardManagedDevice(
    user: AuthenticatedUser,
    gatewayId: string,
  ): Promise<boolean> {
    const since = new Date(
      Date.now() - CLAIM_PROOF_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    const sightings = await this.selectAllPages<
      Pick<DeviceGatewayRow, 'dev_eui'>
    >(
      (from, to) =>
        this.supabaseService
          .getClient()
          .from('cw_device_gateway')
          .select('dev_eui')
          .eq('gateway_id', gatewayId)
          .gte('last_update', since)
          .order('id', { ascending: true })
          .range(from, to) as PromiseLike<
          QueryResult<Pick<DeviceGatewayRow, 'dev_eui'>[]>
        >,
      'Failed to fetch gateway devices',
    );
    if (sightings.length === 0) return false;

    const managed = new Set(
      (await this.accessService.listAccessibleDevices(user))
        .filter((device) => device.canManage)
        .map((device) => device.devEui.toUpperCase()),
    );
    return sightings.some((row) => managed.has(row.dev_eui.toUpperCase()));
  }
}
