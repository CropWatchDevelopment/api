import { ConflictException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeviceSetupService } from './device-setup.service';
import { DeviceSetupException } from './device-setup.errors';
import { encryptAppKey } from './device-key-cipher';
import {
  TtiProvisioningError,
  type CreateOtaaInput,
  type TtiDeviceState,
} from '../../tti/tti-provisioning.service';

const DEV_EUI = '00137A10000441DF';
const OUR_ID = 'eui-00137a10000441df';
const APP_KEY = '2B7E151628AED2A6ABF7158809CF4F3C';
const OTHER_KEY = 'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF';
const CIPHER_KEY = Buffer.alloc(32, 7);
const ORG = 'org-1';
const customer = { sub: 'user-1', email: 'u@example.com', isStaff: false };
const staff = { sub: 'staff-1', email: 's@cropwatch.io', isStaff: true };

type Result = { data?: unknown; error?: unknown; count?: number };

/** Minimal chainable stand-in for the supabase-js query builder. */
class FakeQuery {
  op: 'select' | 'insert' | 'update' | 'delete' = 'select';
  columns = '';
  filters: Record<string, unknown> = {};
  payload: unknown;
  single = false;
  constructor(
    readonly table: string,
    private readonly handler: (query: FakeQuery) => Result,
  ) {}
  select(columns = '') {
    if (this.op === 'select') this.columns = columns;
    return this;
  }
  eq(key: string, value: unknown) {
    this.filters[key] = value;
    return this;
  }
  is() {
    return this;
  }
  like() {
    return this;
  }
  limit() {
    return this;
  }
  insert(payload: unknown) {
    this.op = 'insert';
    this.payload = payload;
    return this;
  }
  update(payload: unknown) {
    this.op = 'update';
    this.payload = payload;
    return this;
  }
  delete() {
    this.op = 'delete';
    return this;
  }
  maybeSingle() {
    this.single = true;
    return Promise.resolve(this.handler(this));
  }
  then<T>(resolve: (value: Result) => T, reject?: (reason: unknown) => T) {
    return Promise.resolve(this.handler(this)).then(resolve, reject);
  }
}

interface Scenario {
  existing?: { name: string; location_id: number; canRead: boolean } | null;
  /** Ownership seen after a 23505 on insert (a concurrent setup won). */
  winner?: { name: string; location_id: number; canRead: boolean };
  existingTti?: { tti_name: string; tti_application_id: string };
  inventory?: { org_id: string | null; device_type_id?: number };
  inventoryError?: boolean;
  profile?: boolean;
  insertError?: { code: string };
  assignedLicense?: boolean;
  /** The chosen device type stores relay data. */
  relay?: boolean;
  /** supports_class_c on the profile row. */
  profileClassC?: boolean;
}

function build(scenario: Scenario = {}) {
  const log: string[] = [];
  const queries: FakeQuery[] = [];
  const ownerNow = () =>
    scenario.insertError && log.includes('insert')
      ? scenario.winner
      : scenario.existing;

  const handler = (q: FakeQuery): Result => {
    queries.push(q);
    switch (q.table) {
      case 'cw_devices': {
        if (q.op === 'insert') {
          log.push('insert');
          return { error: scenario.insertError ?? null };
        }
        if (q.op === 'delete') {
          log.push('release');
          return { error: null };
        }
        if (q.columns.startsWith('tti_name')) {
          return { data: scenario.existingTti ?? null, error: null };
        }
        if ('dev_eui' in q.filters) {
          const owner = ownerNow();
          return {
            data: owner
              ? {
                  dev_eui: DEV_EUI,
                  name: owner.name,
                  location_id: owner.location_id,
                  cw_locations: { name: 'Office' },
                }
              : null,
            error: null,
          };
        }
        return { data: [{ type: 10 }, { type: 10 }], error: null };
      }
      case 'cw_locations':
        return {
          data: { name: 'Office', org_id: ORG, network_region: 'as1' },
          error: null,
        };
      case 'cw_network_profiles':
        if ('region' in q.filters && 'device_type_id' in q.filters) {
          return {
            data:
              scenario.profile === false
                ? null
                : {
                    application_id: 'netvox-ra02a',
                    frequency_plan_id: 'AS_920_923_LBT',
                    lorawan_version: 'MAC_V1_0_3',
                    lorawan_phy_version: 'PHY_V1_0_3_REV_A',
                    supports_class_c: scenario.profileClassC ?? false,
                    default_join_eui: null,
                  },
            error: null,
          };
        }
        if ('region' in q.filters) {
          return { data: [{ device_type_id: 10 }], error: null };
        }
        return { data: [{ application_id: 'netvox-ra02a' }], error: null };
      case 'cw_device_type':
        return q.single
          ? {
              data: {
                TTI_application_id: 'netvox-legacy',
                data_table_v2: scenario.relay ? 'cw_relay_data' : 'cw_air_data',
              },
              error: null,
            }
          : {
              data: [
                { TTI_application_id: 'netvox-legacy' },
                { TTI_application_id: 'cw_ss' },
              ],
              error: null,
            };
      case 'cw_device_inventory':
        if (q.op !== 'select') return { error: null };
        if (scenario.inventoryError) {
          return { data: null, error: { code: 'XX000' } };
        }
        return {
          data: scenario.inventory
            ? {
                device_type_id: scenario.inventory.device_type_id ?? 10,
                join_eui: '0000000000000001',
                app_key_enc: encryptAppKey(APP_KEY, DEV_EUI, CIPHER_KEY),
                org_id: scenario.inventory.org_id,
              }
            : null,
          error: null,
        };
      case 'device_licenses':
        return { count: scenario.assignedLicense ? 1 : 0 };
      default:
        return { data: null, error: null };
    }
  };

  const client = { from: (table: string) => new FakeQuery(table, handler) };
  const access = {
    assertLocationAccess: jest.fn().mockResolvedValue({ orgId: ORG }),
    getDeviceAccess: jest
      .fn()
      .mockImplementation(() =>
        Promise.resolve({ canRead: ownerNow()?.canRead ?? false }),
      ),
  };
  const payments = {
    assertLicenseAvailable: jest.fn().mockResolvedValue(undefined),
    assignLicense: jest.fn().mockImplementation(() => {
      log.push('license');
      return Promise.resolve({});
    }),
  };
  const inspected: TtiDeviceState = {
    region: 'as1',
    appKey: APP_KEY,
    complete: true,
  };
  const tti = {
    findDeviceByDevEui: jest.fn().mockResolvedValue(null),
    inspectDevice: jest.fn().mockResolvedValue(inspected),
    createOtaaDevice: jest.fn().mockImplementation((input: CreateOtaaInput) => {
      log.push('create');
      return Promise.resolve({
        applicationId: input.profile.applicationId,
        deviceId: input.deviceId,
      });
    }),
    completeOtaaDevice: jest.fn().mockImplementation(() => {
      log.push('complete');
      return Promise.resolve();
    }),
    deviceExists: jest.fn().mockResolvedValue(true),
    deleteDevice: jest.fn().mockImplementation(() => {
      log.push('tti-delete');
      return Promise.resolve();
    }),
  };
  const config = {
    get: (key: string) =>
      key === 'PRIVATE_DEVICE_KEY_ENCRYPTION_KEY'
        ? CIPHER_KEY.toString('base64')
        : undefined,
  } as unknown as ConfigService;

  const service = new DeviceSetupService(
    { getClient: () => client } as never,
    access as never,
    payments as never,
    tti as never,
    config,
  );
  const inserts = () =>
    queries.filter((q) => q.table === 'cw_devices' && q.op === 'insert');
  return { service, payments, tti, log, inserts };
}

const body = (extra: Record<string, unknown> = {}) => ({
  dev_eui: '00:13:7a:10:00:04:41:df',
  location_id: 8,
  device_type_id: 10,
  name: 'FL1 Smoke Detector',
  license_id: 14,
  ...extra,
});
const withKeys = (extra: Record<string, unknown> = {}) =>
  body({ join_eui: '0000000000000001', app_key: APP_KEY, ...extra });

const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error instanceof DeviceSetupException ? error.code : error;
  }
  return 'resolved';
};

const found = { applicationId: 'netvox-ra02a', deviceId: 'smoke-1' };

describe('DeviceSetupService.setup — ownership', () => {
  it('rejects a DevEUI owned by another account without touching TTI', async () => {
    const t = build({
      existing: { name: 'X', location_id: 99, canRead: false },
    });
    expect(await codeOf(t.service.setup(customer, withKeys()))).toBe(
      'DEVICE_OWNED_BY_OTHER_ACCOUNT',
    );
    expect(t.tti.findDeviceByDevEui).not.toHaveBeenCalled();
    expect(t.inserts()).toHaveLength(0);
  });

  it('treats a device reserved for another organization as taken', async () => {
    const t = build({ inventory: { org_id: 'org-2' } });
    expect(await codeOf(t.service.setup(customer, withKeys()))).toBe(
      'DEVICE_OWNED_BY_OTHER_ACCOUNT',
    );
    expect(t.tti.findDeviceByDevEui).not.toHaveBeenCalled();
  });

  it('names the existing device when the user already has it under another name', async () => {
    const t = build({
      existing: {
        name: '2nd Floor Smoke Detector',
        location_id: 8,
        canRead: true,
      },
    });
    const error: unknown = await t.service
      .setup(customer, body())
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DeviceSetupException);
    const setupError = error as DeviceSetupException;
    expect(setupError.code).toBe('DEVICE_ALREADY_YOURS');
    expect(setupError.getResponse()).toMatchObject({
      details: { name: '2nd Floor Smoke Detector', location_name: 'Office' },
    });
  });

  it('answers a repeated setup from what exists, writing nothing', async () => {
    const t = build({
      existing: { name: 'fl1 smoke detector', location_id: 8, canRead: true },
      existingTti: { tti_name: OUR_ID, tti_application_id: 'netvox-ra02a' },
      assignedLicense: true,
    });
    const result = await t.service.setup(customer, body());
    expect(t.log).toEqual([]);
    expect(t.payments.assignLicense).not.toHaveBeenCalled();
    expect(result.steps).toEqual([
      { key: 'availability', outcome: 'done' },
      expect.objectContaining({ key: 'network', outcome: 'existing' }),
      { key: 'saved', outcome: 'existing' },
      { key: 'license', outcome: 'existing' },
    ]);
  });

  it('reports a setup still in progress when the claim has no registration yet', async () => {
    const t = build({
      existing: { name: 'FL1 Smoke Detector', location_id: 8, canRead: true },
      existingTti: { tti_name: OUR_ID, tti_application_id: 'netvox-ra02a' },
    });
    t.tti.deviceExists.mockResolvedValue(false);
    expect(await codeOf(t.service.setup(customer, body()))).toBe(
      'SETUP_IN_PROGRESS',
    );
  });

  it('rejects a name that is only spaces', async () => {
    const t = build();
    expect(
      await codeOf(t.service.setup(customer, withKeys({ name: '   ' }))),
    ).toBe('INVALID_NAME');
  });
});

describe('DeviceSetupService.setup — new devices', () => {
  it('claims the DevEUI before registering it, then uses the license', async () => {
    const t = build();
    const result = await t.service.setup(
      customer,
      withKeys({
        join_eui: '00-00-00-00-00-00-00-01',
        app_key: APP_KEY.toLowerCase()
          .replace(/(.{4})/g, '$1 ')
          .trim(),
        group: 'CropWatch',
        lat: 35.1,
        long: 139.2,
        installed_at: '2026-10-11',
      }),
    );

    expect(t.log).toEqual(['insert', 'create', 'license']);
    expect(t.tti.createOtaaDevice).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: OUR_ID,
        joinEui: '0000000000000001',
        appKey: APP_KEY,
      }),
      expect.any(AbortSignal),
    );
    expect(t.inserts()[0].payload).toMatchObject({
      dev_eui: DEV_EUI,
      group: 'CropWatch',
      lat: 35.1,
      long: 139.2,
      installed_at: '2026-10-11',
      tti_name: OUR_ID,
      tti_application_id: 'netvox-ra02a',
      user_id: 'user-1',
    });
    expect(result.steps[1]).toMatchObject({ outcome: 'created' });
  });

  it('registers relays as Class C even when the profile row says otherwise', async () => {
    const t = build({ relay: true, profileClassC: false });
    await t.service.setup(customer, withKeys());
    expect(t.tti.createOtaaDevice).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: expect.objectContaining({ supportsClassC: true }) as unknown,
      }),
      expect.any(AbortSignal),
    );
  });

  it('never registers anything but a relay as Class C', async () => {
    const t = build({ relay: false, profileClassC: true });
    await t.service.setup(customer, withKeys());
    expect(t.tti.createOtaaDevice).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: expect.objectContaining({ supportsClassC: false }) as unknown,
      }),
      expect.any(AbortSignal),
    );
  });

  it('asks for keys when the device is new and not on file', async () => {
    const t = build();
    expect(await codeOf(t.service.setup(customer, body()))).toBe(
      'KEYS_REQUIRED',
    );
    expect(t.log).toEqual([]);
  });

  it('rejects malformed keys before calling TTI', async () => {
    const t = build();
    expect(
      await codeOf(t.service.setup(customer, withKeys({ app_key: 'ABC' }))),
    ).toBe('INVALID_KEYS');
    expect(t.tti.findDeviceByDevEui).not.toHaveBeenCalled();
  });

  it('uses inventory keys reserved for this organization', async () => {
    const t = build({ inventory: { org_id: ORG } });
    await t.service.setup(customer, body());
    expect(t.tti.createOtaaDevice).toHaveBeenCalledWith(
      expect.objectContaining({ joinEui: '0000000000000001', appKey: APP_KEY }),
      expect.any(AbortSignal),
    );
  });

  it('ignores unreserved inventory keys for customers', async () => {
    const t = build({ inventory: { org_id: null } });
    expect(await codeOf(t.service.setup(customer, body()))).toBe(
      'KEYS_REQUIRED',
    );
  });

  it('releases the claim when the network rejects the registration', async () => {
    const t = build();
    t.tti.createOtaaDevice.mockRejectedValue(
      new TtiProvisioningError('invalid', 'bad plan', 400),
    );
    expect(await codeOf(t.service.setup(customer, withKeys()))).toBe(
      'SETUP_FAILED',
    );
    expect(t.log).toEqual(['insert', 'release']);
    expect(t.payments.assignLicense).not.toHaveBeenCalled();
  });

  it('releases the claim and the registration when the license fails', async () => {
    const t = build();
    const failure = new ConflictException('License is already assigned');
    t.payments.assignLicense.mockRejectedValue(failure);
    await expect(t.service.setup(customer, withKeys())).rejects.toBe(failure);
    expect(t.log).toEqual(['insert', 'create', 'release', 'tti-delete']);
  });

  it('stops before touching TTI when it loses the race for the DevEUI', async () => {
    const t = build({
      insertError: { code: '23505' },
      winner: { name: 'FL1 Smoke Detector', location_id: 8, canRead: true },
    });
    expect(await codeOf(t.service.setup(customer, withKeys()))).toBe(
      'SETUP_IN_PROGRESS',
    );
    expect(t.log).toEqual(['insert']);
  });

  it('reports another account when that account won the race', async () => {
    const t = build({
      insertError: { code: '23505' },
      winner: { name: 'Theirs', location_id: 99, canRead: false },
    });
    expect(await codeOf(t.service.setup(customer, withKeys()))).toBe(
      'DEVICE_OWNED_BY_OTHER_ACCOUNT',
    );
  });

  it('saves nothing when TTI is down', async () => {
    const t = build();
    t.tti.findDeviceByDevEui.mockRejectedValue(
      new TtiProvisioningError('unavailable', 'no response'),
    );
    expect(await codeOf(t.service.setup(customer, withKeys()))).toBe(
      'NETWORK_UNAVAILABLE',
    );
    expect(t.log).toEqual([]);
  });

  it('fails closed when the inventory cannot be read', async () => {
    const t = build({ inventoryError: true });
    expect(await codeOf(t.service.setup(customer, withKeys()))).toBe(
      'SETUP_FAILED',
    );
    expect(t.log).toEqual([]);
  });

  it('requires a license for customers', async () => {
    const t = build();
    expect(
      await codeOf(
        t.service.setup(customer, withKeys({ license_id: undefined })),
      ),
    ).toBe('LICENSE_REQUIRED');
  });

  it('refuses models without a profile in the location region', async () => {
    const t = build({ profile: false });
    expect(await codeOf(t.service.setup(customer, withKeys()))).toBe(
      'MODEL_NOT_AVAILABLE_IN_REGION',
    );
  });
});

describe('DeviceSetupService.setup — devices already on the network', () => {
  it('adopts it when the AppKey matches the Join Server', async () => {
    const t = build();
    t.tti.findDeviceByDevEui.mockResolvedValue(found);
    const result = await t.service.setup(customer, withKeys());
    expect(t.log).toEqual(['insert', 'license']);
    expect(t.inserts()[0].payload).toMatchObject({
      tti_name: 'smoke-1',
      tti_application_id: 'netvox-ra02a',
    });
    expect(result.steps[1]).toMatchObject({ outcome: 'adopted' });
  });

  it('asks a customer to prove they hold the device', async () => {
    const t = build();
    t.tti.findDeviceByDevEui.mockResolvedValue(found);
    const error = (await t.service
      .setup(customer, body())
      .catch((e: unknown) => e)) as DeviceSetupException;
    expect(error.code).toBe('KEYS_REQUIRED');
    expect(error.getResponse()).toMatchObject({
      details: { reason: 'verify' },
    });
    expect(t.log).toEqual([]);
  });

  it('refuses an AppKey that does not match', async () => {
    const t = build();
    t.tti.findDeviceByDevEui.mockResolvedValue(found);
    expect(
      await codeOf(t.service.setup(customer, withKeys({ app_key: OTHER_KEY }))),
    ).toBe('KEYS_DO_NOT_MATCH');
    expect(t.log).toEqual([]);
  });

  it('refuses a registration whose keys cannot be read', async () => {
    const t = build();
    t.tti.findDeviceByDevEui.mockResolvedValue(found);
    t.tti.inspectDevice.mockResolvedValue({
      region: 'as1',
      appKey: null,
      complete: true,
    });
    expect(await codeOf(t.service.setup(customer, withKeys()))).toBe(
      'NETWORK_DEVICE_UNVERIFIABLE',
    );
  });

  it('refuses a registration that belongs to another model', async () => {
    const t = build();
    t.tti.findDeviceByDevEui.mockResolvedValue({
      applicationId: 'dragino-ja-lt-22222',
      deviceId: 'relay-1',
    });
    expect(await codeOf(t.service.setup(customer, withKeys()))).toBe(
      'NETWORK_MODEL_MISMATCH',
    );
    expect(t.tti.inspectDevice).not.toHaveBeenCalled();
  });

  it('accepts the model’s legacy application', async () => {
    const t = build();
    t.tti.findDeviceByDevEui.mockResolvedValue({
      applicationId: 'netvox-legacy',
      deviceId: 'old-1',
    });
    await t.service.setup(customer, withKeys());
    expect(t.inserts()[0].payload).toMatchObject({
      tti_application_id: 'netvox-legacy',
    });
  });

  it('lets staff adopt without keys', async () => {
    const t = build();
    t.tti.findDeviceByDevEui.mockResolvedValue(found);
    const result = await t.service.setup(
      staff,
      body({ license_id: undefined }),
    );
    expect(result.steps[1]).toMatchObject({ outcome: 'adopted' });
    expect(t.log).toEqual(['insert']);
  });

  it('completes an unfinished registration of its own with the keys provided', async () => {
    const t = build();
    t.tti.findDeviceByDevEui.mockResolvedValue({
      applicationId: 'netvox-ra02a',
      deviceId: OUR_ID,
    });
    t.tti.inspectDevice.mockResolvedValue({
      region: 'as1',
      appKey: null,
      complete: false,
    });
    await t.service.setup(customer, withKeys());
    expect(t.log).toEqual(['insert', 'complete', 'license']);
  });

  it('never modifies someone else’s incomplete registration', async () => {
    const t = build();
    t.tti.findDeviceByDevEui.mockResolvedValue(found);
    t.tti.inspectDevice.mockResolvedValue({
      region: 'as1',
      appKey: APP_KEY,
      complete: false,
    });
    expect(await codeOf(t.service.setup(staff, withKeys()))).toBe(
      'NETWORK_DEVICE_UNVERIFIABLE',
    );
    expect(t.tti.completeOtaaDevice).not.toHaveBeenCalled();
  });

  it('keeps an adopted registration when the license fails', async () => {
    const t = build();
    t.tti.findDeviceByDevEui.mockResolvedValue(found);
    t.payments.assignLicense.mockRejectedValue(new ConflictException('taken'));
    await t.service.setup(customer, withKeys()).catch(() => undefined);
    expect(t.log).toEqual(['insert', 'release']);
    expect(t.tti.deleteDevice).not.toHaveBeenCalled();
  });

  it('never logs the AppKey', async () => {
    const spies = (['log', 'warn', 'error'] as const).map((level) =>
      jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined),
    );
    const t = build();
    t.tti.findDeviceByDevEui.mockResolvedValue(found);
    await t.service
      .setup(customer, withKeys({ app_key: OTHER_KEY }))
      .catch(() => undefined);
    const t2 = build();
    t2.tti.createOtaaDevice.mockRejectedValue(
      new TtiProvisioningError('invalid', 'bad request', 400),
    );
    await t2.service.setup(customer, withKeys()).catch(() => undefined);

    const logged = spies
      .flatMap((spy) => spy.mock.calls.flat() as unknown[])
      .map(String)
      .join(' ');
    expect(logged).not.toContain(APP_KEY);
    expect(logged).not.toContain(OTHER_KEY);
    spies.forEach((spy) => spy.mockRestore());
  });
});

describe('DeviceSetupService.lookup', () => {
  it('answers customers from the database only', async () => {
    const t = build();
    const result = await t.service.lookup(customer, {
      dev_eui: '00137a10000441df',
      location_id: 8,
    });
    expect(result).toMatchObject({
      dev_eui: DEV_EUI,
      region: 'as1',
      ownership: { status: 'available' },
      model: { device_type_id: 10, source: 'prefix' },
      keys: 'required',
      network: { status: 'unknown' },
      supported_device_type_ids: [10],
    });
    expect(t.tti.findDeviceByDevEui).not.toHaveBeenCalled();
  });

  it('says nothing more about a device another account owns', async () => {
    const t = build({
      existing: { name: 'X', location_id: 9, canRead: false },
    });
    const result = await t.service.lookup(customer, {
      dev_eui: DEV_EUI,
      location_id: 8,
    });
    expect(result).toMatchObject({
      ownership: { status: 'other_account' },
      model: { device_type_id: null, suggested_device_type_ids: [] },
      supported_device_type_ids: [],
    });
  });

  it('reports a device reserved for another organization as taken', async () => {
    const t = build({ inventory: { org_id: 'org-2' } });
    const result = await t.service.lookup(customer, {
      dev_eui: DEV_EUI,
      location_id: 8,
    });
    expect(result.ownership).toEqual({ status: 'other_account' });
    expect(result.keys).toBe('required');
  });

  it('reports keys on file only when the device is reserved for this organization', async () => {
    const t = build({ inventory: { org_id: ORG, device_type_id: 6 } });
    const result = await t.service.lookup(customer, {
      dev_eui: DEV_EUI,
      location_id: 8,
    });
    expect(result).toMatchObject({
      keys: 'inventory',
      model: { device_type_id: 6, source: 'inventory' },
    });
  });

  it('shows staff where a device is registered', async () => {
    const t = build();
    t.tti.findDeviceByDevEui.mockResolvedValue(found);
    const result = await t.service.lookup(staff, {
      dev_eui: DEV_EUI,
      location_id: 8,
    });
    expect(result).toMatchObject({
      keys: 'network',
      network: { status: 'registered', application_id: 'netvox-ra02a' },
    });
  });

  it('rejects a malformed DevEUI', async () => {
    const t = build();
    expect(
      await codeOf(
        t.service.lookup(customer, {
          dev_eui: '00137A10000441D',
          location_id: 8,
        }),
      ),
    ).toBe('INVALID_DEV_EUI');
  });
});
