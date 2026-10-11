import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import { SupabaseService } from '../../../supabase/supabase.service';
import { AccessService, Action } from '../../common/authz';
import { PaymentsService } from '../../payments/payments.service';
import type { AuthenticatedUser } from '../../auth/authenticated-user';
import {
  TTI_REGIONS,
  TtiProvisioningError,
  TtiProvisioningService,
  type TtiDeviceProfile,
  type TtiDeviceRef,
  type TtiRegion,
} from '../../tti/tti-provisioning.service';
import { decryptAppKey, readCipherKey } from './device-key-cipher';
import type { DeviceSetupDto, DeviceSetupLookupDto } from './device-setup.dto';
import {
  DeviceSetupException,
  newSetupReference,
  type DeviceSetupErrorCode,
} from './device-setup.errors';

const HEX16 = /^[0-9A-F]{16}$/;
const HEX32 = /^[0-9A-F]{32}$/;
const TTI_ID = /^[a-z0-9](?:-?[a-z0-9]){2,}$/;
/** Budget for the TTI reads and writes of one setup (cleanup has its own). */
const NETWORK_BUDGET_MS = 60_000;
/**
 * Relays are always Class C (commands must reach them immediately) and the
 * only Class C devices. A device type is a relay when it stores relay data.
 */
const RELAY_DATA_TABLE = 'cw_relay_data';

/** Strips separators (space, colon, dash) and upper-cases. */
const cleanHex = (value: string | null | undefined): string =>
  (value ?? '').replace(/[\s:-]/g, '').toUpperCase();

/** Constant-time comparison of two hex keys. */
const sameKey = (a: string, b: string): boolean => {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
};

export type DeviceOwnership =
  | { status: 'available' }
  | {
      status: 'yours';
      device: {
        dev_eui: string;
        name: string;
        location_id: number | null;
        location_name: string | null;
      };
    }
  | { status: 'other_account' };

export interface DeviceSetupLookupResult {
  dev_eui: string;
  region: TtiRegion;
  ownership: DeviceOwnership;
  model: {
    device_type_id: number | null;
    source: 'inventory' | 'prefix' | null;
    /** Device types already used with this DevEUI prefix, most common first. */
    suggested_device_type_ids: number[];
  };
  /** Where the join keys will come from. 'network' is only reported to staff. */
  keys: 'inventory' | 'network' | 'required';
  /** Network state is only checked for staff (for anyone else it would leak). */
  network:
    | { status: 'registered'; application_id: string }
    | { status: 'not_registered' }
    | { status: 'unknown' };
  /** Device types that can be set up in this location's region. */
  supported_device_type_ids: number[];
}

export type DeviceSetupStep =
  | { key: 'availability'; outcome: 'done' }
  | {
      key: 'network';
      outcome: 'created' | 'adopted' | 'existing';
      application_id: string;
      region: TtiRegion;
    }
  | { key: 'saved'; outcome: 'done' | 'existing' }
  | { key: 'license'; outcome: 'done' | 'existing' | 'skipped' };

export interface DeviceSetupResult {
  dev_eui: string;
  location_id: number;
  name: string;
  steps: DeviceSetupStep[];
}

interface ProfileRow {
  application_id: string;
  frequency_plan_id: string;
  lorawan_version: string;
  lorawan_phy_version: string;
  supports_class_c: boolean;
  default_join_eui: string | null;
}

interface InventoryRow {
  device_type_id: number | null;
  join_eui: string;
  app_key_enc: string;
  org_id: string | null;
}

interface DeviceTypeRow {
  data_table_v2: string | null;
  TTI_application_id: string | null;
}

interface LocationRow {
  name: string | null;
  org_id: string | null;
  network_region: string | null;
}

type YoursDevice = Extract<DeviceOwnership, { status: 'yours' }>['device'];

/**
 * How the caller may use a key-inventory row:
 *  - usable: reserved for this location's organization (or caller is staff)
 *  - reserved_elsewhere: shipped to another organization — blocks setup
 *  - unassigned: in stock, not yet reserved — treated like any device
 */
type InventoryAccess = 'none' | 'usable' | 'reserved_elsewhere' | 'unassigned';

interface OtaaKeys {
  joinEui: string;
  appKey: string;
}

/** What setup will do on the network, decided before anything is written. */
type NetworkPlan =
  | { kind: 'create'; ref: TtiDeviceRef; keys: OtaaKeys }
  | { kind: 'repair'; ref: TtiDeviceRef; keys: OtaaKeys }
  | { kind: 'adopt'; ref: TtiDeviceRef };

/**
 * Guided device setup.
 *
 * Order matters for safety:
 *  1. read-only checks: ownership, license, network profile, the existing TTI
 *     registration and — when adopting one — proof that the caller holds the
 *     device (its AppKey matches the Join Server, it is reserved for their
 *     organization, or they are staff);
 *  2. claim the DevEUI with the cw_devices insert (the primary key serializes
 *     concurrent setups of one device);
 *  3. only then write to TTI, then consume the license — releasing the claim
 *     and anything this request registered if a later step fails.
 * Repeating a finished setup (same user, name and location) is answered from
 * what exists, without writing anything.
 */
@Injectable()
export class DeviceSetupService {
  private readonly logger = new Logger(DeviceSetupService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly accessService: AccessService,
    private readonly paymentsService: PaymentsService,
    private readonly tti: TtiProvisioningService,
    private readonly configService: ConfigService,
  ) {}

  private fail(
    reference: string,
    devEui: string,
    code: DeviceSetupErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ): never {
    this.logger.warn(`device-setup ${reference} ${devEui || '-'}: ${code}`);
    throw new DeviceSetupException(code, message, reference, details);
  }

  private normalizeDevEui(value: string, reference: string): string {
    const devEui = cleanHex(value);
    if (!HEX16.test(devEui)) {
      this.fail(
        reference,
        '',
        'INVALID_DEV_EUI',
        'A DevEUI is 16 hexadecimal characters (0-9, A-F).',
      );
    }
    return devEui;
  }

  // ---------------------------------------------------------------------------
  // Lookup
  // ---------------------------------------------------------------------------

  async lookup(
    user: AuthenticatedUser,
    dto: DeviceSetupLookupDto,
  ): Promise<DeviceSetupLookupResult> {
    const reference = newSetupReference();
    const devEui = this.normalizeDevEui(dto.dev_eui, reference);
    await this.accessService.assertLocationAccess(
      user,
      dto.location_id,
      Action.LocationDeviceCreate,
    );

    const [location, found, inventory] = await Promise.all([
      this.loadLocation(reference, devEui, dto.location_id),
      this.resolveOwnership(reference, user, devEui),
      this.loadInventory(reference, devEui),
    ]);
    const region = this.regionOf(reference, devEui, location);
    const inventoryAccess = this.inventoryAccess(inventory, location, user);
    const ownership: DeviceOwnership =
      found.status === 'available' && inventoryAccess === 'reserved_elsewhere'
        ? { status: 'other_account' }
        : found;

    // Nothing more is said about a device the caller cannot set up.
    if (ownership.status !== 'available') {
      return {
        dev_eui: devEui,
        region,
        ownership,
        model: {
          device_type_id: null,
          source: null,
          suggested_device_type_ids: [],
        },
        keys: 'required',
        network: { status: 'unknown' },
        supported_device_type_ids: [],
      };
    }

    const [suggested, supported] = await Promise.all([
      this.suggestDeviceTypes(devEui),
      this.supportedDeviceTypes(reference, devEui, region),
    ]);

    // Only staff learn whether (and where) a DevEUI is on the network: for
    // anyone else it would point out unclaimed devices worth guessing at.
    let network: DeviceSetupLookupResult['network'] = { status: 'unknown' };
    if (user.isStaff) {
      try {
        const existing = await this.tti.findDeviceByDevEui(
          devEui,
          await this.candidateApplications(reference, devEui),
          AbortSignal.timeout(NETWORK_BUDGET_MS),
        );
        network = existing
          ? { status: 'registered', application_id: existing.applicationId }
          : { status: 'not_registered' };
      } catch (error) {
        this.logger.warn(
          `device-setup ${reference} ${devEui}: TTI lookup failed (${
            error instanceof Error ? error.message : String(error)
          })`,
        );
      }
    }

    const inventoryType =
      inventoryAccess === 'usable' ? (inventory?.device_type_id ?? null) : null;
    return {
      dev_eui: devEui,
      region,
      ownership,
      model: {
        device_type_id:
          inventoryType ?? (suggested.length === 1 ? suggested[0] : null),
        source: inventoryType
          ? 'inventory'
          : suggested.length
            ? 'prefix'
            : null,
        suggested_device_type_ids: suggested,
      },
      keys:
        network.status === 'registered'
          ? 'network'
          : inventoryAccess === 'usable'
            ? 'inventory'
            : 'required',
      network,
      supported_device_type_ids: supported,
    };
  }

  // ---------------------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------------------

  async setup(
    user: AuthenticatedUser,
    dto: DeviceSetupDto,
  ): Promise<DeviceSetupResult> {
    const reference = newSetupReference();
    const devEui = this.normalizeDevEui(dto.dev_eui, reference);
    const name = dto.name.trim();
    if (!name) {
      this.fail(reference, devEui, 'INVALID_NAME', 'Give the device a name.');
    }
    await this.accessService.assertLocationAccess(
      user,
      dto.location_id,
      Action.LocationDeviceCreate,
    );
    const deadline = AbortSignal.timeout(NETWORK_BUDGET_MS);

    const [location, ownership, inventory] = await Promise.all([
      this.loadLocation(reference, devEui, dto.location_id),
      this.resolveOwnership(reference, user, devEui),
      this.loadInventory(reference, devEui),
    ]);
    const region = this.regionOf(reference, devEui, location);
    const inventoryAccess = this.inventoryAccess(inventory, location, user);

    // 1. Ownership.
    if (ownership.status === 'yours') {
      return this.resume(
        reference,
        devEui,
        ownership.device,
        name,
        dto,
        region,
        deadline,
      );
    }
    if (
      ownership.status === 'other_account' ||
      inventoryAccess === 'reserved_elsewhere'
    ) {
      this.failOtherAccount(reference, devEui);
    }

    // 2. License — validated before anything is written anywhere.
    const licenseId = dto.license_id ?? null;
    if (!user.isStaff && !licenseId) {
      this.fail(
        reference,
        devEui,
        'LICENSE_REQUIRED',
        'An available device license is required to add a device.',
      );
    }
    if (licenseId) {
      await this.paymentsService.assertLicenseAvailable(user, licenseId);
    }

    // 3. Network profile and plan (reads only).
    const [profile, deviceType] = await Promise.all([
      this.loadProfile(reference, devEui, dto.device_type_id, region),
      this.loadDeviceType(reference, devEui, dto.device_type_id),
    ]);
    if (!profile || !deviceType) {
      this.fail(
        reference,
        devEui,
        'MODEL_NOT_AVAILABLE_IN_REGION',
        'This device model is not yet available in this location’s network region.',
        { region, device_type_id: dto.device_type_id },
      );
    }
    const keys = this.resolveKeys(
      reference,
      devEui,
      profile,
      dto,
      inventoryAccess === 'usable' ? inventory : null,
    );
    const plan = await this.planNetwork(
      reference,
      user,
      devEui,
      dto.device_type_id,
      deviceType.TTI_application_id,
      profile,
      keys,
      inventoryAccess === 'usable',
      deadline,
    );

    // 4. Claim the DevEUI. The insert carries every field, so there is no
    //    follow-up update; the primary key turns a concurrent setup of the
    //    same device into a conflict instead of a second registration.
    const client = this.supabaseService.getClient();
    const { error: insertError } = await client.from('cw_devices').insert({
      dev_eui: devEui,
      name,
      type: dto.device_type_id,
      group: dto.group?.trim() || null,
      location_id: dto.location_id,
      lat: dto.lat ?? null,
      long: dto.long ?? null,
      installed_at: dto.installed_at ?? null,
      tti_name: plan.ref.deviceId,
      tti_application_id: plan.ref.applicationId,
      user_id: user.sub,
    });
    if (insertError) {
      if (insertError.code === '23505') {
        const winner = await this.resolveOwnership(reference, user, devEui);
        if (winner.status === 'yours') {
          if (this.isSameDevice(winner.device, name, dto.location_id)) {
            this.failInProgress(reference, devEui);
          }
          this.failAlreadyYours(reference, devEui, winner.device);
        }
        this.failOtherAccount(reference, devEui);
      }
      this.dbFail(reference, devEui, 'insert failed', insertError.code);
    }

    // 5. Network writes. On failure the claim is released (TTI cleans up after
    //    itself inside createOtaaDevice).
    const releaseClaim = async () => {
      const { error } = await client
        .from('cw_devices')
        .delete()
        .eq('dev_eui', devEui)
        .eq('user_id', user.sub);
      if (error) {
        this.logger.error(
          `device-setup ${reference} ${devEui}: could not release the claim (${error.code})`,
        );
      }
    };
    if (plan.kind !== 'adopt') {
      const input = {
        profile: this.ttiProfile(
          reference,
          devEui,
          profile,
          region,
          deviceType.data_table_v2 === RELAY_DATA_TABLE,
        ),
        deviceId: plan.ref.deviceId,
        devEui,
        joinEui: plan.keys.joinEui,
        appKey: plan.keys.appKey,
      };
      try {
        if (plan.kind === 'create') {
          await this.tti.createOtaaDevice(input, deadline);
        } else {
          await this.tti.completeOtaaDevice(input, deadline);
        }
      } catch (error) {
        await releaseClaim();
        this.failTti(reference, devEui, error);
      }
    }

    // 6. Consume the license; undo the claim and our registration on failure.
    let licenseOutcome: 'done' | 'skipped' = 'skipped';
    if (licenseId) {
      try {
        await this.paymentsService.assignLicense(user, licenseId, devEui);
        licenseOutcome = 'done';
      } catch (error) {
        await releaseClaim();
        if (plan.kind === 'create') {
          await this.tti.deleteDevice(region, plan.ref);
        }
        throw error;
      }
    }

    // 7. Inventory keys are now in use.
    if (inventoryAccess === 'usable') {
      const { error } = await client
        .from('cw_device_inventory')
        .update({ claimed_at: new Date().toISOString(), claimed_by: user.sub })
        .eq('dev_eui', devEui)
        .is('claimed_at', null);
      if (error) {
        this.logger.warn(
          `device-setup ${reference} ${devEui}: inventory not marked claimed (${error.code})`,
        );
      }
    }

    this.logger.log(
      `device-setup ${reference} ${devEui}: ${plan.kind} ${plan.ref.applicationId}/${plan.ref.deviceId}`,
    );
    return {
      dev_eui: devEui,
      location_id: dto.location_id,
      name,
      steps: [
        { key: 'availability', outcome: 'done' },
        {
          key: 'network',
          outcome: plan.kind === 'adopt' ? 'adopted' : 'created',
          application_id: plan.ref.applicationId,
          region,
        },
        { key: 'saved', outcome: 'done' },
        { key: 'license', outcome: licenseOutcome },
      ],
    };
  }

  /**
   * The DevEUI is already the caller's. The same name and location means an
   * earlier attempt finished (e.g. its response was lost): report it without
   * writing anything. Anything else is a different device of theirs.
   */
  private async resume(
    reference: string,
    devEui: string,
    existing: YoursDevice,
    name: string,
    dto: DeviceSetupDto,
    region: TtiRegion,
    deadline: AbortSignal,
  ): Promise<DeviceSetupResult> {
    if (!this.isSameDevice(existing, name, dto.location_id)) {
      this.failAlreadyYours(reference, devEui, existing);
    }

    const { data: row, error } = (await this.supabaseService
      .getClient()
      .from('cw_devices')
      .select('tti_name, tti_application_id')
      .eq('dev_eui', devEui)
      .maybeSingle()) as {
      data: {
        tti_name: string | null;
        tti_application_id: string | null;
      } | null;
      error: { code?: string } | null;
    };
    if (error || !row) {
      this.dbFail(reference, devEui, 'resume read failed', error?.code);
    }

    // A claim whose registration is not on the network yet belongs to a setup
    // that is still running (or about to roll back).
    if (row.tti_name && row.tti_application_id) {
      const ref = {
        applicationId: row.tti_application_id,
        deviceId: row.tti_name,
      };
      const exists = await this.callTti(reference, devEui, () =>
        this.tti.deviceExists(ref, deadline),
      );
      if (!exists) this.failInProgress(reference, devEui);
    }

    const hasLicense = await this.hasAssignedLicense(devEui);
    return {
      dev_eui: devEui,
      location_id: dto.location_id,
      name: existing.name,
      steps: [
        { key: 'availability', outcome: 'done' },
        {
          key: 'network',
          outcome: 'existing',
          application_id: row.tti_application_id ?? '',
          region,
        },
        { key: 'saved', outcome: 'existing' },
        { key: 'license', outcome: hasLicense ? 'existing' : 'skipped' },
      ],
    };
  }

  /**
   * Decides how the device gets onto the network, reading only.
   * An existing registration is adopted only when the caller proves they hold
   * the device: staff, an inventory reservation for this organization, or an
   * AppKey that matches the Join Server. Otherwise anyone who guessed a DevEUI
   * could take over its data (and, for relays, its controls).
   */
  private async planNetwork(
    reference: string,
    user: AuthenticatedUser,
    devEui: string,
    deviceTypeId: number,
    typeApplicationId: string | null,
    profile: ProfileRow,
    keys: OtaaKeys | null,
    reservedForCaller: boolean,
    deadline: AbortSignal,
  ): Promise<NetworkPlan> {
    const ours: TtiDeviceRef = {
      applicationId: profile.application_id,
      deviceId: `eui-${devEui.toLowerCase()}`,
    };
    const candidates = await this.candidateApplications(
      reference,
      devEui,
      profile.application_id,
    );
    const found = await this.callTti(reference, devEui, () =>
      this.tti.findDeviceByDevEui(devEui, candidates, deadline),
    );

    if (!found) {
      if (!keys) {
        this.fail(
          reference,
          devEui,
          'KEYS_REQUIRED',
          'Enter the JoinEUI and AppKey from the device label.',
        );
      }
      return { kind: 'create', ref: ours, keys };
    }

    // The registration must belong to this model, or its data and controls
    // would be handled through the wrong application.
    const modelApps = await this.applicationsForDeviceType(
      reference,
      devEui,
      deviceTypeId,
      typeApplicationId,
    );
    if (!modelApps.includes(found.applicationId)) {
      this.fail(
        reference,
        devEui,
        'NETWORK_MODEL_MISMATCH',
        'This device is registered on the network as a different model.',
      );
    }

    const state = await this.callTti(reference, devEui, () =>
      this.tti.inspectDevice(found, deadline),
    );
    const isOurs =
      found.applicationId === ours.applicationId &&
      found.deviceId === ours.deviceId;
    const trusted = user.isStaff || reservedForCaller;

    if (!trusted) {
      if (!keys) {
        this.fail(
          reference,
          devEui,
          'KEYS_REQUIRED',
          'This device is already on the network. Enter its AppKey to confirm it is yours.',
          { reason: 'verify' },
        );
      }
      if (state.appKey) {
        if (!sameKey(state.appKey, keys.appKey)) {
          this.fail(
            reference,
            devEui,
            'KEYS_DO_NOT_MATCH',
            'That AppKey does not match this device’s network registration.',
          );
        }
      } else if (!isOurs) {
        this.fail(
          reference,
          devEui,
          'NETWORK_DEVICE_UNVERIFIABLE',
          'This device is on the network, but its keys cannot be checked automatically.',
        );
      }
    }

    // An unfinished registration made by an earlier setup is completed with
    // the keys now provided; someone else's is never modified.
    if (!state.complete || !state.appKey) {
      if (!isOurs) {
        this.fail(
          reference,
          devEui,
          'NETWORK_DEVICE_UNVERIFIABLE',
          'This device is on the network, but its registration is incomplete.',
        );
      }
      if (!keys) {
        this.fail(
          reference,
          devEui,
          'KEYS_REQUIRED',
          'Enter the JoinEUI and AppKey to finish this device’s registration.',
          { reason: 'verify' },
        );
      }
      return { kind: 'repair', ref: found, keys };
    }

    return { kind: 'adopt', ref: found };
  }

  /** Keys from a usable inventory row, else from the request; null when none given. */
  private resolveKeys(
    reference: string,
    devEui: string,
    profile: ProfileRow,
    dto: DeviceSetupDto,
    inventory: InventoryRow | null,
  ): OtaaKeys | null {
    if (inventory) {
      try {
        return {
          joinEui: inventory.join_eui,
          appKey: decryptAppKey(
            inventory.app_key_enc,
            devEui,
            readCipherKey(
              this.configService.get<string>(
                'PRIVATE_DEVICE_KEY_ENCRYPTION_KEY',
              ),
            ),
          ),
        };
      } catch (error) {
        this.logger.error(
          `device-setup ${reference} ${devEui}: inventory key unreadable (${
            error instanceof Error ? error.message : String(error)
          })`,
        );
        // Fall through to keys from the request.
      }
    }

    if (!dto.app_key && !dto.join_eui) return null;
    const joinEui = cleanHex(dto.join_eui) || profile.default_join_eui || '';
    const appKey = cleanHex(dto.app_key);
    if (!HEX16.test(joinEui) || !HEX32.test(appKey)) {
      this.fail(
        reference,
        devEui,
        'INVALID_KEYS',
        'The JoinEUI must be 16 and the AppKey 32 hexadecimal characters.',
        { join_eui: HEX16.test(joinEui), app_key: HEX32.test(appKey) },
      );
    }
    return { joinEui, appKey };
  }

  /**
   * Class C follows the device type, not the profile row: relays always,
   * nothing else ever. A row that disagrees is reported so it gets fixed.
   */
  private ttiProfile(
    reference: string,
    devEui: string,
    profile: ProfileRow,
    region: TtiRegion,
    isRelay: boolean,
  ): TtiDeviceProfile {
    if (profile.supports_class_c !== isRelay) {
      this.logger.warn(
        `device-setup ${reference} ${devEui}: profile ${profile.application_id}/${region} has supports_class_c=${profile.supports_class_c}; using ${isRelay}`,
      );
    }
    return {
      region,
      applicationId: profile.application_id,
      frequencyPlanId: profile.frequency_plan_id,
      lorawanVersion: profile.lorawan_version,
      lorawanPhyVersion: profile.lorawan_phy_version,
      supportsClassC: isRelay,
    };
  }

  private isSameDevice(
    existing: YoursDevice,
    name: string,
    locationId: number,
  ): boolean {
    return (
      existing.name.trim().toLowerCase() === name.toLowerCase() &&
      existing.location_id === locationId
    );
  }

  private failOtherAccount(reference: string, devEui: string): never {
    this.fail(
      reference,
      devEui,
      'DEVICE_OWNED_BY_OTHER_ACCOUNT',
      'This device is registered to another CropWatch account.',
    );
  }

  private failInProgress(reference: string, devEui: string): never {
    this.fail(
      reference,
      devEui,
      'SETUP_IN_PROGRESS',
      'This device is already being set up. Check the location in a moment.',
    );
  }

  private failAlreadyYours(
    reference: string,
    devEui: string,
    existing: YoursDevice,
  ): never {
    this.fail(
      reference,
      devEui,
      'DEVICE_ALREADY_YOURS',
      `You have already added this device as "${existing.name}".`,
      {
        name: existing.name,
        location_id: existing.location_id,
        location_name: existing.location_name,
      },
    );
  }

  private inventoryAccess(
    inventory: InventoryRow | null,
    location: LocationRow,
    user: AuthenticatedUser,
  ): InventoryAccess {
    if (!inventory) return 'none';
    if (user.isStaff) return 'usable';
    if (!inventory.org_id) return 'unassigned';
    return inventory.org_id === location.org_id
      ? 'usable'
      : 'reserved_elsewhere';
  }

  private async callTti<T>(
    reference: string,
    devEui: string,
    run: () => Promise<T>,
  ): Promise<T> {
    try {
      return await run();
    } catch (error) {
      return this.failTti(reference, devEui, error);
    }
  }

  private failTti(reference: string, devEui: string, error: unknown): never {
    if (error instanceof DeviceSetupException) throw error;
    const kind = error instanceof TtiProvisioningError ? error.kind : null;
    this.logger.error(
      `device-setup ${reference} ${devEui}: TTI ${kind ?? 'error'} (${
        error instanceof Error ? error.message : String(error)
      })`,
    );
    switch (kind) {
      case 'not_configured':
      case 'forbidden':
        return this.fail(
          reference,
          devEui,
          'NETWORK_NOT_CONFIGURED',
          'Network registration is not available right now. Please contact support.',
        );
      case 'unavailable':
        return this.fail(
          reference,
          devEui,
          'NETWORK_UNAVAILABLE',
          'The network server did not respond. Nothing was saved; please try again.',
        );
      case 'eui_taken':
        return this.fail(
          reference,
          devEui,
          'NETWORK_EUI_CLAIMED_ELSEWHERE',
          'This DevEUI is registered elsewhere on the network.',
        );
      default:
        return this.fail(
          reference,
          devEui,
          'SETUP_FAILED',
          'The network rejected the registration. Please contact support.',
        );
    }
  }

  // ---------------------------------------------------------------------------
  // Data — errors fail the request; nothing falls back to a guessed default.
  // ---------------------------------------------------------------------------

  private dbFail(
    reference: string,
    devEui: string,
    what: string,
    code?: string,
  ): never {
    this.logger.error(
      `device-setup ${reference} ${devEui}: ${what} (${code ?? 'error'})`,
    );
    this.fail(
      reference,
      devEui,
      'SETUP_FAILED',
      'Something went wrong on our side. Nothing was saved.',
    );
  }

  private async resolveOwnership(
    reference: string,
    user: AuthenticatedUser,
    devEui: string,
  ): Promise<DeviceOwnership> {
    const { data, error } = (await this.supabaseService
      .getClient()
      .from('cw_devices')
      .select('dev_eui, name, location_id, cw_locations(name)')
      .eq('dev_eui', devEui)
      .maybeSingle()) as {
      data: {
        dev_eui: string;
        name: string;
        location_id: number | null;
        cw_locations: { name: string | null } | null;
      } | null;
      error: { code?: string } | null;
    };
    if (error)
      this.dbFail(reference, devEui, 'device lookup failed', error.code);
    if (!data) return { status: 'available' };

    const access = await this.accessService.getDeviceAccess(user, devEui);
    if (!access.canRead) return { status: 'other_account' };
    return {
      status: 'yours',
      device: {
        dev_eui: data.dev_eui,
        name: data.name,
        location_id: data.location_id,
        location_name: data.cw_locations?.name ?? null,
      },
    };
  }

  private async loadLocation(
    reference: string,
    devEui: string,
    locationId: number,
  ): Promise<LocationRow> {
    const { data, error } = (await this.supabaseService
      .getClient()
      .from('cw_locations')
      .select('name, org_id, network_region')
      .eq('location_id', locationId)
      .maybeSingle()) as {
      data: LocationRow | null;
      error: { code?: string } | null;
    };
    if (error || !data) {
      this.dbFail(reference, devEui, 'location lookup failed', error?.code);
    }
    return data;
  }

  private regionOf(
    reference: string,
    devEui: string,
    location: LocationRow,
  ): TtiRegion {
    const region = location.network_region as TtiRegion | null;
    // The column is NOT NULL with a CHECK; anything else is a schema problem.
    if (!region || !TTI_REGIONS.includes(region)) {
      this.dbFail(reference, devEui, 'location has no network region');
    }
    return region;
  }

  private async loadProfile(
    reference: string,
    devEui: string,
    deviceTypeId: number,
    region: TtiRegion,
  ): Promise<ProfileRow | null> {
    const { data, error } = (await this.supabaseService
      .getClient()
      .from('cw_network_profiles')
      .select(
        'application_id, frequency_plan_id, lorawan_version, lorawan_phy_version, supports_class_c, default_join_eui',
      )
      .eq('device_type_id', deviceTypeId)
      .eq('region', region)
      .eq('is_active', true)
      .maybeSingle()) as {
      data: ProfileRow | null;
      error: { code?: string } | null;
    };
    if (error)
      this.dbFail(reference, devEui, 'profile lookup failed', error.code);
    return data;
  }

  private async supportedDeviceTypes(
    reference: string,
    devEui: string,
    region: TtiRegion,
  ): Promise<number[]> {
    const { data, error } = (await this.supabaseService
      .getClient()
      .from('cw_network_profiles')
      .select('device_type_id')
      .eq('region', region)
      .eq('is_active', true)) as {
      data: { device_type_id: number }[] | null;
      error: { code?: string } | null;
    };
    if (error)
      this.dbFail(reference, devEui, 'profile list failed', error.code);
    return (data ?? []).map((row) => row.device_type_id);
  }

  private async loadInventory(
    reference: string,
    devEui: string,
  ): Promise<InventoryRow | null> {
    const { data, error } = (await this.supabaseService
      .getClient()
      .from('cw_device_inventory')
      .select('device_type_id, join_eui, app_key_enc, org_id')
      .eq('dev_eui', devEui)
      .maybeSingle()) as {
      data: InventoryRow | null;
      error: { code?: string } | null;
    };
    // Fail closed: a reservation that cannot be read must not be ignored.
    if (error) {
      this.dbFail(reference, devEui, 'inventory lookup failed', error.code);
    }
    return data;
  }

  /** Device types already in use with this DevEUI's 24-bit prefix (advisory). */
  private async suggestDeviceTypes(devEui: string): Promise<number[]> {
    const { data } = (await this.supabaseService
      .getClient()
      .from('cw_devices')
      .select('type')
      .like('dev_eui', `${devEui.slice(0, 6)}%`)
      .limit(500)) as { data: { type: number | null }[] | null };
    const counts = new Map<number, number>();
    for (const row of data ?? []) {
      if (row.type != null) {
        counts.set(row.type, (counts.get(row.type) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([type]) => type);
  }

  private async hasAssignedLicense(devEui: string): Promise<boolean> {
    const { count } = (await this.supabaseService
      .getClient()
      .from('device_licenses')
      .select('id', { count: 'exact', head: true })
      .eq('dev_eui', devEui)) as { count: number | null };
    return (count ?? 0) > 0;
  }

  private async loadDeviceType(
    reference: string,
    devEui: string,
    deviceTypeId: number,
  ): Promise<DeviceTypeRow | null> {
    const { data, error } = (await this.supabaseService
      .getClient()
      .from('cw_device_type')
      .select('data_table_v2, TTI_application_id')
      .eq('id', deviceTypeId)
      .maybeSingle()) as {
      data: DeviceTypeRow | null;
      error: { code?: string } | null;
    };
    if (error) {
      this.dbFail(reference, devEui, 'device type lookup failed', error.code);
    }
    return data;
  }

  /** TTI applications a device of this model may legitimately live in. */
  private async applicationsForDeviceType(
    reference: string,
    devEui: string,
    deviceTypeId: number,
    typeApplicationId: string | null,
  ): Promise<string[]> {
    const { data, error } = (await this.supabaseService
      .getClient()
      .from('cw_network_profiles')
      .select('application_id')
      .eq('device_type_id', deviceTypeId)) as {
      data: { application_id: string }[] | null;
      error: { code?: string } | null;
    };
    if (error) {
      this.dbFail(
        reference,
        devEui,
        'model applications lookup failed',
        error.code,
      );
    }
    return [
      ...(data ?? []).map((row) => row.application_id),
      typeApplicationId ?? '',
    ].filter((id) => TTI_ID.test(id));
  }

  /** Every TTI application a CropWatch device may already live in. */
  private async candidateApplications(
    reference: string,
    devEui: string,
    include?: string,
  ): Promise<string[]> {
    const client = this.supabaseService.getClient();
    const [profiles, types] = (await Promise.all([
      client.from('cw_network_profiles').select('application_id'),
      client.from('cw_device_type').select('TTI_application_id'),
    ])) as [
      {
        data: { application_id: string }[] | null;
        error: { code?: string } | null;
      },
      {
        data: { TTI_application_id: string | null }[] | null;
        error: { code?: string } | null;
      },
    ];
    if (profiles.error || types.error) {
      this.dbFail(reference, devEui, 'application list failed');
    }
    return [
      ...new Set(
        [
          include ?? '',
          ...(profiles.data ?? []).map((row) => row.application_id),
          ...(types.data ?? []).map((row) => row.TTI_application_id ?? ''),
        ].filter((id) => TTI_ID.test(id)),
      ),
    ];
  }
}
