import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PostgrestError } from '@supabase/supabase-js';
import { SupabaseService } from '../../supabase/supabase.service';
import type { TableInsert, TableRow } from '../../v1/types/supabase';
import { PulseRelayDto } from './dto/pulse-relay.dto';
import { UpdateRelayDto } from './dto/update-relay.dto';
import {
  buildRelayDownlink,
  buildTimedRelayDownlink,
} from './relay-command-profile';
import { RelayCommandLockService } from './relay-command-lock.service';
import {
  parseRelayConfirmation,
  readRelayRowTimestamp,
} from './relay-confirmation';
import {
  getOtherRelayNumber,
  getRelayState,
  type RelayConfirmation,
} from './relay.types';
import {
  createTtiClient,
  mapTtiClientError,
  resolveTtiApplicationId,
} from './tti-client';
import { isValidTtiDeviceId, normalizeTtiDeviceId } from './tti-device-id';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import {
  AccessService,
  Action,
  type DeviceAccess,
  decide,
} from '../common/authz';

type DeviceOwnerRow = TableRow<'cw_device_owners'>;
type DeviceTypeRow = TableRow<'cw_device_type'>;
type DeviceRow = TableRow<'cw_devices'>;
type RelayRow = TableRow<'cw_relay_data'>;
type RelayInsert = TableInsert<'cw_relay_data'>;

/** Shape of a PostgREST response from the untyped Supabase client. */
type QueryResult<T> = { data: T | null; error: PostgrestError | null };

type RelayDeviceContext = {
  applicationId: string;
  device: DeviceRow;
  deviceId: string;
  access: DeviceAccess;
};

type DeviceRecord = DeviceRow & {
  cw_device_owners?: DeviceOwnerRow[];
  cw_device_type?: DeviceTypeRow | DeviceTypeRow[] | null;
};

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeDevEui(value: string): string {
  return value.trim().toUpperCase();
}

function unwrapSingleRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

function readBearerToken(value: string | undefined): string {
  const raw = readString(value);
  if (!raw) {
    return '';
  }

  const [scheme, token] = raw.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return '';
  }

  return token.trim();
}

function buildRelayCorrelationIds(input: {
  devEui: string;
  relay: 1 | 2;
  requestId: string;
  targetState?: 'off' | 'on';
  durationMs?: number;
  kind: 'fixed' | 'pulse';
}): string[] {
  const correlationIds = [
    `cropwatch:request:${input.requestId}`,
    `cropwatch:device:${input.devEui}`,
    `cropwatch:relay:${input.relay}`,
    `cropwatch:kind:${input.kind}`,
  ];

  if (input.targetState) {
    correlationIds.push(`cropwatch:target:${input.targetState}`);
  }

  if (typeof input.durationMs === 'number') {
    correlationIds.push(`cropwatch:duration_ms:${input.durationMs}`);
  }

  return correlationIds;
}

@Injectable()
export class RelayService {
  private readonly logger = new Logger(RelayService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly relayCommandLockService: RelayCommandLockService,
    private readonly supabaseService: SupabaseService,
    private readonly accessService: AccessService,
  ) {
    if (
      !readString(this.configService.get<string>('PRIVATE_TTI_WEBHOOK_TOKEN'))
    ) {
      this.logger.warn(
        'PRIVATE_TTI_WEBHOOK_TOKEN is not set — the TTI relay webhook will reject all uplinks until it is configured',
      );
    }
  }

  async getLatestRelay(user: AuthenticatedUser, devEui: string) {
    const normalizedDevEui = normalizeDevEui(devEui);
    if (!normalizedDevEui) {
      throw new BadRequestException('dev_eui is required');
    }

    // Loads for the 404/TTI validation side effects; the row is not needed.
    await this.loadRelayDeviceContext(user, normalizedDevEui);

    const latestRow = await this.findLatestRelayRow(normalizedDevEui);
    if (!latestRow) {
      throw new NotFoundException('Latest relay data not found');
    }

    return latestRow;
  }

  async updateRelay(
    user: AuthenticatedUser,
    devEui: string,
    updateRelayDto: UpdateRelayDto,
  ) {
    const normalizedDevEui = normalizeDevEui(devEui);
    if (!normalizedDevEui) {
      throw new BadRequestException('dev_eui is required');
    }

    const { relay, targetState } = updateRelayDto;
    const context = await this.loadRelayDeviceContext(user, normalizedDevEui);
    if (!decide(context.access, Action.RelayControl)) {
      throw new ForbiddenException(
        'You do not have permission to control this relay',
      );
    }

    const latestRow = await this.findLatestRelayRow(normalizedDevEui);
    const currentState = getRelayState(latestRow, relay);
    if (currentState !== null) {
      const alreadyInTarget =
        (targetState === 'on' && currentState) ||
        (targetState === 'off' && !currentState);

      if (alreadyInTarget) {
        return {
          confirmed: true,
          data: latestRow,
          dev_eui: normalizedDevEui,
          message: `Relay ${relay} is already ${targetState}`,
          relay,
          targetState,
        };
      }
    }

    const releaseLock = this.relayCommandLockService.acquire(normalizedDevEui);
    const requestedAt = new Date().toISOString();

    try {
      const ttiClient = createTtiClient(this.configService);
      const requestId = globalThis.crypto.randomUUID();
      const correlationIds = buildRelayCorrelationIds({
        devEui: normalizedDevEui,
        kind: 'fixed',
        relay,
        requestId,
        targetState,
      });

      await ttiClient.replaceDownlinkQueue({
        applicationId: context.applicationId,
        deviceId: context.deviceId,
        downlinks: [buildRelayDownlink(relay, targetState, correlationIds)],
      });

      return {
        confirmed: true,
        dev_eui: normalizedDevEui,
        message: `Relay ${relay} confirmed ${targetState} by TTI`,
        relay,
        requestedAt,
        targetState,
      };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof ForbiddenException ||
        error instanceof InternalServerErrorException ||
        error instanceof NotFoundException ||
        error instanceof UnauthorizedException
      ) {
        throw error;
      }

      throw mapTtiClientError(error);
    } finally {
      releaseLock();
    }
  }

  async pulseRelay(
    user: AuthenticatedUser,
    devEui: string,
    pulseRelayDto: PulseRelayDto,
  ) {
    const normalizedDevEui = normalizeDevEui(devEui);
    if (!normalizedDevEui) {
      throw new BadRequestException('dev_eui is required');
    }

    const { durationSeconds, relay } = pulseRelayDto;
    const context = await this.loadRelayDeviceContext(user, normalizedDevEui);
    if (!decide(context.access, Action.RelayControl)) {
      throw new ForbiddenException(
        'You do not have permission to control this relay',
      );
    }

    const latestRow = await this.findLatestRelayRow(normalizedDevEui);
    const currentRelayState = getRelayState(latestRow, relay);
    const otherRelay = getOtherRelayNumber(relay);
    const currentOtherRelayState = getRelayState(latestRow, otherRelay);

    if (currentRelayState === null || currentOtherRelayState === null) {
      throw new BadRequestException(
        'Timed relay pulse requires a confirmed current state for both relays',
      );
    }

    if (currentRelayState) {
      throw new ConflictException(
        'Timed relay pulse requires the target relay to currently be off',
      );
    }

    const durationMs = durationSeconds * 1000;
    const releaseLock = this.relayCommandLockService.acquire(normalizedDevEui);
    const requestedAt = new Date().toISOString();

    try {
      const ttiClient = createTtiClient(this.configService);
      const requestId = globalThis.crypto.randomUUID();
      const correlationIds = buildRelayCorrelationIds({
        devEui: normalizedDevEui,
        durationMs,
        kind: 'pulse',
        relay,
        requestId,
        targetState: 'on',
      });

      await ttiClient.replaceDownlinkQueue({
        applicationId: context.applicationId,
        deviceId: context.deviceId,
        downlinks: [
          buildTimedRelayDownlink({
            correlationIds,
            durationMs,
            relay1On: relay === 1 ? true : currentOtherRelayState,
            relay2On: relay === 2 ? true : currentOtherRelayState,
          }),
        ],
      });

      return {
        confirmed: true,
        dev_eui: normalizedDevEui,
        durationMs,
        durationSeconds,
        message: `Relay ${relay} pulse queued for ${durationSeconds} seconds`,
        relay,
        requestedAt,
        targetState: 'on',
      };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof ConflictException ||
        error instanceof ForbiddenException ||
        error instanceof InternalServerErrorException ||
        error instanceof NotFoundException ||
        error instanceof UnauthorizedException
      ) {
        throw error;
      }

      throw mapTtiClientError(error);
    } finally {
      releaseLock();
    }
  }

  async handleTtiUp(
    payload: unknown,
    authorizationHeader?: string,
    downlinkApiKeyHeader?: string,
  ) {
    this.assertWebhookAuthorization(authorizationHeader, downlinkApiKeyHeader);

    const confirmation = parseRelayConfirmation(payload);
    if (!confirmation) {
      return {
        processed: false,
      };
    }

    const row = await this.persistRelayConfirmation(confirmation);

    return {
      confirmedAt: readRelayRowTimestamp(row),
      dev_eui: row.dev_eui,
      processed: true,
      relay_1: row.relay_1,
      relay_2: row.relay_2,
    };
  }

  private assertWebhookAuthorization(
    authorizationHeader?: string,
    downlinkApiKeyHeader?: string,
  ): void {
    const expectedToken = readString(
      this.configService.get<string>('PRIVATE_TTI_WEBHOOK_TOKEN'),
    );

    // Fail closed: a missing token must never mean "accept everything".
    if (!expectedToken) {
      this.logger.error(
        'PRIVATE_TTI_WEBHOOK_TOKEN is not configured — rejecting relay webhook',
      );
      throw new UnauthorizedException('Relay webhook is not configured');
    }

    const actualToken =
      readBearerToken(authorizationHeader) || readString(downlinkApiKeyHeader);
    if (!actualToken || actualToken !== expectedToken) {
      throw new UnauthorizedException('Invalid relay webhook token');
    }
  }

  private async loadRelayDeviceContext(
    user: AuthenticatedUser,
    devEui: string,
  ): Promise<RelayDeviceContext> {
    const client = this.supabaseService.getClient();

    const { data, error } = (await client
      .from('cw_devices')
      .select('*, cw_device_type(*)')
      .eq('dev_eui', devEui)
      .maybeSingle()) as QueryResult<DeviceRecord>;

    if (error) {
      this.logger.error(
        `Failed to fetch relay device context for ${devEui}`,
        error.message,
      );
      throw new InternalServerErrorException('Failed to fetch relay device');
    }

    if (!data) {
      throw new NotFoundException('Device not found');
    }

    const device = data;
    const deviceId = normalizeTtiDeviceId(device.tti_name);
    if (!deviceId || !isValidTtiDeviceId(deviceId)) {
      throw new BadRequestException('Device is missing a valid TTI device id');
    }

    const deviceType = unwrapSingleRelation(device.cw_device_type);
    const applicationId = resolveTtiApplicationId(
      deviceType?.TTI_application_id,
      this.configService.get<string>('PRIVATE_TTI_DEFAULT_APPLICATION_ID'),
    );

    if (!applicationId) {
      throw new InternalServerErrorException(
        'Device is missing a TTI application id',
      );
    }

    // Central resolution: org overlay + device override + location default.
    // An invisible device is a 404, matching every other device surface.
    const access = await this.accessService.getDeviceAccess(user, devEui);
    if (!access.canRead || !decide(access, Action.RelayRead)) {
      throw new NotFoundException('Device not found');
    }

    return {
      applicationId,
      device,
      deviceId,
      access,
    };
  }

  private async findLatestRelayRow(devEui: string): Promise<RelayRow | null> {
    const client = this.supabaseService.getClient();
    const { data, error } = (await client
      .from('cw_relay_data')
      .select('*')
      .eq('dev_eui', devEui)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle()) as QueryResult<RelayRow>;

    if (error) {
      this.logger.error(
        `Failed to fetch latest relay row for ${devEui}`,
        error.message,
      );
      throw new InternalServerErrorException('Failed to fetch relay data');
    }

    return data ?? null;
  }

  private async persistRelayConfirmation(
    confirmation: RelayConfirmation,
  ): Promise<RelayRow> {
    const client = this.supabaseService.getClient();
    const latestRow = await this.findLatestRelayRow(confirmation.devEui);

    const mergedRow: RelayInsert = {
      created_at: latestRow?.created_at ?? confirmation.receivedAt,
      dev_eui: confirmation.devEui,
      last_update: confirmation.receivedAt,
      relay_1: confirmation.relay1 ?? latestRow?.relay_1 ?? null,
      relay_2: confirmation.relay2 ?? latestRow?.relay_2 ?? null,
    };

    const { data, error } = (await client
      .from('cw_relay_data')
      .upsert(mergedRow, {
        onConflict: 'dev_eui',
      })
      .select('*')
      .single()) as QueryResult<RelayRow>;

    if (error || !data) {
      this.logger.error(
        `Failed to upsert relay confirmation row for ${confirmation.devEui}`,
        error?.message,
      );
      throw new InternalServerErrorException(
        'Failed to store relay confirmation',
      );
    }

    return data;
  }
}
