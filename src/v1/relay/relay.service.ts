import {
  BadRequestException,
  ForbiddenException,
  GatewayTimeoutException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../../supabase/supabase.service';
import {
  getAccessToken,
  getUserId,
  isCropwatchStaff,
} from '../../supabase/supabase-token.helper';
import type { TableInsert, TableRow } from '../../v1/types/supabase';
import { UpdateRelayDto } from './dto/update-relay.dto';
import { buildRelayDownlink } from './relay-command-profile';
import { RelayCommandLockService } from './relay-command-lock.service';
import {
  doesRelayRowConfirmTarget,
  parseRelayConfirmation,
  readRelayRowTimestamp,
} from './relay-confirmation';
import { getRelayState, type RelayConfirmation } from './relay.types';
import {
  createTtiClient,
  mapTtiClientError,
  resolveTtiApplicationId,
} from './tti-client';
import {
  isValidTtiDeviceId,
  normalizeTtiDeviceId,
} from './tti-device-id';

type DeviceOwnerRow = TableRow<'cw_device_owners'>;
type DeviceTypeRow = TableRow<'cw_device_type'>;
type LocationOwnerRow = TableRow<'cw_location_owners'>;
type DeviceRow = TableRow<'cw_devices'>;
type RelayRow = TableRow<'cw_relay_data'>;
type RelayInsert = TableInsert<'cw_relay_data'>;

type RelayDeviceContext = {
  applicationId: string;
  device: DeviceRow;
  deviceId: string;
  permissionLevel: number;
};

type DeviceRecord = DeviceRow & {
  cw_device_owners?: DeviceOwnerRow[];
  cw_device_type?: DeviceTypeRow | DeviceTypeRow[] | null;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeDevEui(value: string): string {
  return value.trim().toUpperCase();
}

function getDefaultPermissionLevel(): number {
  return 4;
}

function readPermissionLevel(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : getDefaultPermissionLevel();
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

@Injectable()
export class RelayService {
  private readonly logger = new Logger(RelayService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly relayCommandLockService: RelayCommandLockService,
    private readonly supabaseService: SupabaseService,
  ) {}

  async updateRelay(
    jwtPayload: any,
    authHeader: string,
    devEui: string,
    updateRelayDto: UpdateRelayDto,
  ) {
    const normalizedDevEui = normalizeDevEui(devEui);
    if (!normalizedDevEui) {
      throw new BadRequestException('dev_eui is required');
    }

    const { relay, targetState } = updateRelayDto;
    const context = await this.loadRelayDeviceContext(
      jwtPayload,
      authHeader,
      normalizedDevEui,
    );
    if (context.permissionLevel > 2) {
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
      const correlationIds = [
        `cropwatch:request:${requestId}`,
        `cropwatch:device:${normalizedDevEui}`,
        `cropwatch:relay:${relay}`,
        `cropwatch:target:${targetState}`,
      ];

      await ttiClient.replaceDownlinkQueue({
        applicationId: context.applicationId,
        deviceId: context.deviceId,
        downlinks: [buildRelayDownlink(relay, targetState, correlationIds)],
      });

      // const confirmedRow = await this.waitForRelayConfirmation(
      //   normalizedDevEui,
      //   relay,
      //   targetState,
      //   requestedAt,
      // );

      return {
        confirmed: true,
        dev_eui: normalizedDevEui,
        message: `Relay ${relay} confirmed ${targetState} by TTI`,
        relay,
        requestedAt,
        targetState,
      };
    } catch (error) {
      if (error instanceof GatewayTimeoutException) {
        throw error;
      }

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

  async handleTtiUp(payload: unknown, authorizationHeader?: string) {
    this.assertWebhookAuthorization(authorizationHeader);

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

  private assertWebhookAuthorization(authorizationHeader?: string): void {
    const expectedToken = readString(
      this.configService.get<string>('PRIVATE_TTI_WEBHOOK_TOKEN'),
    );

    if (!expectedToken) {
      return;
    }

    const actualToken = readBearerToken(authorizationHeader);
    if (!actualToken || actualToken !== expectedToken) {
      throw new UnauthorizedException('Invalid relay webhook token');
    }
  }

  private async loadRelayDeviceContext(
    jwtPayload: any,
    authHeader: string,
    devEui: string,
  ): Promise<RelayDeviceContext> {
    const accessToken = getAccessToken(authHeader);
    const client = this.supabaseService.getClient(accessToken);
    const userId = getUserId(jwtPayload);
    const isGlobalUser = isCropwatchStaff(jwtPayload);

    const { data, error } = await client
      .from('cw_devices')
      .select('*, cw_device_owners(*), cw_device_type(*)')
      .eq('dev_eui', devEui)
      .maybeSingle();

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

    const device = data as DeviceRecord;
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

    const permissionLevel = isGlobalUser
      ? 0
      : await this.resolvePermissionLevel(client, device, userId);

    return {
      applicationId,
      device,
      deviceId,
      permissionLevel,
    };
  }

  private async resolvePermissionLevel(
    client: ReturnType<SupabaseService['getClient']>,
    device: DeviceRecord,
    userId: string,
  ): Promise<number> {
    const permissionLevels: number[] = [];

    if (device.user_id && device.user_id === userId) {
      permissionLevels.push(0);
    }

    for (const owner of device.cw_device_owners ?? []) {
      if (readString(owner.user_id) === userId) {
        permissionLevels.push(readPermissionLevel(owner.permission_level));
      }
    }

    if (device.location_id) {
      const { data, error } = await client
        .from('cw_location_owners')
        .select('*')
        .eq('location_id', device.location_id)
        .eq('user_id', userId);

      if (error) {
        this.logger.error(
          `Failed to fetch location ownership for relay device ${device.dev_eui}`,
          error.message,
        );
        throw new InternalServerErrorException(
          'Failed to resolve relay permissions',
        );
      }

      for (const owner of (data ?? []) as LocationOwnerRow[]) {
        permissionLevels.push(readPermissionLevel(owner.permission_level));
      }
    }

    return permissionLevels.length > 0
      ? Math.min(...permissionLevels)
      : getDefaultPermissionLevel();
  }

  private async findLatestRelayRow(devEui: string): Promise<RelayRow | null> {
    const client = this.supabaseService.getClient();
    const { data, error } = await client
      .from('cw_relay_data')
      .select('*')
      .eq('dev_eui', devEui)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      this.logger.error(
        `Failed to fetch latest relay row for ${devEui}`,
        error.message,
      );
      throw new InternalServerErrorException('Failed to fetch relay data');
    }

    return (data as RelayRow | null) ?? null;
  }

  private async waitForRelayConfirmation(
    devEui: string,
    relay: 1 | 2,
    targetState: 'off' | 'on',
    requestedAt: string,
  ): Promise<RelayRow> {
    const timeoutMs = this.readConfirmationTimeoutMs();
    const pollIntervalMs = this.readConfirmationPollIntervalMs();
    const deadline = Date.now() + timeoutMs;

    while (Date.now() <= deadline) {
      const latestRow = await this.findLatestRelayRow(devEui);
      if (
        latestRow &&
        doesRelayRowConfirmTarget(latestRow, relay, targetState, requestedAt)
      ) {
        return latestRow;
      }

      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        break;
      }

      await sleep(Math.min(pollIntervalMs, remainingMs));
    }

    throw new GatewayTimeoutException(
      `Timed out waiting for relay ${relay} confirmation from TTI`,
    );
  }

  private readConfirmationTimeoutMs(): number {
    const parsed = Number(
      this.configService.get<string>('PRIVATE_TTI_RELAY_CONFIRMATION_TIMEOUT_MS'),
    );

    if (Number.isFinite(parsed) && parsed >= 1000) {
      return parsed;
    }

    return 35_000;
  }

  private readConfirmationPollIntervalMs(): number {
    const parsed = Number(
      this.configService.get<string>('PRIVATE_TTI_RELAY_CONFIRMATION_POLL_MS'),
    );

    if (Number.isFinite(parsed) && parsed >= 250) {
      return parsed;
    }

    return 1000;
  }

  private async persistRelayConfirmation(
    confirmation: RelayConfirmation,
  ): Promise<RelayRow> {
    const client = this.supabaseService.getClient();
    const latestRow = await this.findLatestRelayRow(confirmation.devEui);
    const mergedRow: RelayInsert = {
      created_at: confirmation.receivedAt,
      dev_eui: confirmation.devEui,
      last_update: confirmation.receivedAt,
      relay_1:
        confirmation.relay1 ?? latestRow?.relay_1 ?? null,
      relay_2:
        confirmation.relay2 ?? latestRow?.relay_2 ?? null,
    };

    const { data: existingRow, error: existingError } = await client
      .from('cw_relay_data')
      .select('*')
      .eq('dev_eui', confirmation.devEui)
      .eq('last_update', confirmation.receivedAt)
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingError) {
      this.logger.error(
        `Failed to check existing relay confirmation row for ${confirmation.devEui}`,
        existingError.message,
      );
      throw new InternalServerErrorException(
        'Failed to store relay confirmation',
      );
    }

    if (existingRow) {
      const { data, error } = await client
        .from('cw_relay_data')
        .update(mergedRow)
        .eq('id', existingRow.id)
        .select('*')
        .single();

      if (error || !data) {
        this.logger.error(
          `Failed to update relay confirmation row ${existingRow.id}`,
          error?.message,
        );
        throw new InternalServerErrorException(
          'Failed to update relay confirmation',
        );
      }

      return data as RelayRow;
    }

    const { data, error } = await client
      .from('cw_relay_data')
      .insert(mergedRow)
      .select('*')
      .single();

    if (error || !data) {
      this.logger.error(
        `Failed to insert relay confirmation row for ${confirmation.devEui}`,
        error?.message,
      );
      throw new InternalServerErrorException(
        'Failed to insert relay confirmation',
      );
    }

    return data as RelayRow;
  }
}
