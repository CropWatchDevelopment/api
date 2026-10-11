import { ConfigService } from '@nestjs/config';
import {
  parseClusterBaseUrls,
  TtiProvisioningError,
  TtiProvisioningService,
  type TtiDeviceProfile,
} from './tti-provisioning.service';

const IDENTITY = 'https://cropwatch.eu1.cloud.thethings.industries';
const AS1 = 'https://cropwatch.as1.cloud.thethings.industries';
const APP_KEY = '2B7E151628AED2A6ABF7158809CF4F3C';
const DEVICE = `${AS1}/api/v3/{server}/applications/netvox-ra02a/devices/eui-00137a10000441df`;
const IS_DEVICE = `${IDENTITY}/api/v3/applications/netvox-ra02a/devices/eui-00137a10000441df`;

const profile: TtiDeviceProfile = {
  region: 'as1',
  applicationId: 'netvox-ra02a',
  frequencyPlanId: 'AS_920_923_LBT',
  lorawanVersion: 'MAC_V1_0_3',
  lorawanPhyVersion: 'PHY_V1_0_3_REV_A',
  supportsClassC: false,
};

interface Call {
  method: string;
  url: string;
  body: Record<string, unknown> | null;
}

type Reply = { status: number; body?: unknown };

function build(respond: (call: Call) => Reply) {
  const config = {
    get: (key: string) =>
      ({
        PRIVATE_TTI_IDENTITY_BASE_URL: IDENTITY,
        PRIVATE_TTI_CLUSTER_BASE_URLS: `as1=${AS1}/,au1=https://x.au1`,
        PRIVATE_TTI_PROVISIONING_API_KEY: 'NNSXS.test',
      })[key],
  } as unknown as ConfigService;
  const service = new TtiProvisioningService(config);
  const calls: Call[] = [];
  service.fetchFn = jest.fn(
    (input: string | URL | Request, init?: RequestInit) => {
      const call: Call = {
        method: init?.method ?? 'GET',
        url: input instanceof Request ? input.url : input.toString(),
        body:
          typeof init?.body === 'string'
            ? (JSON.parse(init.body) as Record<string, unknown>)
            : null,
      };
      calls.push(call);
      const { status, body } = respond(call);
      return Promise.resolve(
        new Response(body === undefined ? '' : JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
      );
    },
  );
  return { service, calls };
}

const ok: Reply = { status: 200, body: {} };
const taken = (name: string): Reply => ({
  status: 409,
  body: { message: 'secret detail', details: [{ name }] },
});

const input = {
  profile,
  deviceId: 'eui-00137a10000441df',
  devEui: '00137a10000441df',
  joinEui: '0000000000000001',
  appKey: APP_KEY.toLowerCase(),
};

const methodsAndUrls = (calls: Call[]) =>
  calls.map((c) => `${c.method} ${c.url}`);

describe('parseClusterBaseUrls', () => {
  it('reads region=url pairs and drops unknown regions', () => {
    expect(
      parseClusterBaseUrls(`as1=${AS1}/, xx1=https://nope, au1=https://a`),
    ).toEqual({ as1: AS1, au1: 'https://a' });
  });
});

describe('TtiProvisioningService.createOtaaDevice', () => {
  it('registers on the Identity, Join, Network and Application Servers in order', async () => {
    const { service, calls } = build(() => ok);

    await expect(service.createOtaaDevice(input)).resolves.toEqual({
      applicationId: 'netvox-ra02a',
      deviceId: 'eui-00137a10000441df',
    });

    expect(methodsAndUrls(calls)).toEqual([
      `POST ${IDENTITY}/api/v3/applications/netvox-ra02a/devices`,
      `PUT ${DEVICE.replace('{server}', 'js')}`,
      `PUT ${DEVICE.replace('{server}', 'ns')}`,
      `PUT ${DEVICE.replace('{server}', 'as')}`,
    ]);
    const [identity, js, ns] = calls;
    expect(identity.body).toMatchObject({
      end_device: {
        ids: { dev_eui: '00137A10000441DF', join_eui: '0000000000000001' },
        join_server_address: 'cropwatch.as1.cloud.thethings.industries',
      },
    });
    expect(js.body).toMatchObject({
      end_device: { root_keys: { app_key: { key: APP_KEY } } },
      field_mask: {
        paths: expect.arrayContaining(['root_keys.app_key.key']) as unknown,
      },
    });
    expect(ns.body).toMatchObject({
      end_device: {
        frequency_plan_id: 'AS_920_923_LBT',
        lorawan_version: 'MAC_V1_0_3',
        supports_join: true,
      },
    });
  });

  it('removes the device from every server when a later step is rejected', async () => {
    const { service, calls } = build((call) =>
      call.method === 'PUT' && call.url.includes('/ns/')
        ? {
            status: 400,
            body: { details: [{ name: 'unknown_frequency_plan' }] },
          }
        : ok,
    );

    const error: unknown = await service
      .createOtaaDevice(input)
      .catch((e: unknown) => e);

    expect(error).toMatchObject({
      kind: 'invalid',
      ttiName: 'unknown_frequency_plan',
    });
    expect(
      calls.filter((c) => c.method === 'DELETE').map((c) => c.url),
    ).toEqual([
      DEVICE.replace('{server}', 'as'),
      DEVICE.replace('{server}', 'ns'),
      DEVICE.replace('{server}', 'js'),
      IS_DEVICE,
    ]);
  });

  it('never retries the create, and cleans up in case it landed', async () => {
    const { service, calls } = build((call) =>
      call.method === 'POST' ? { status: 503 } : { status: 404 },
    );

    await expect(service.createOtaaDevice(input)).rejects.toMatchObject({
      kind: 'unavailable',
    });
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(4);
  });

  it('completes its own earlier registration of the same DevEUI', async () => {
    const { service, calls } = build((call) => {
      if (call.method === 'POST') return taken('id_taken');
      if (call.method === 'GET') {
        return {
          status: 200,
          body: { ids: { dev_eui: '00137A10000441DF' } },
        };
      }
      return ok;
    });

    await service.createOtaaDevice(input);
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(3);
  });

  it('refuses a device ID that belongs to another DevEUI', async () => {
    const { service, calls } = build((call) => {
      if (call.method === 'POST') return taken('id_taken');
      if (call.method === 'GET') {
        return { status: 200, body: { ids: { dev_eui: 'AAAAAAAAAAAAAAAA' } } };
      }
      return ok;
    });

    await expect(service.createOtaaDevice(input)).rejects.toMatchObject({
      kind: 'eui_taken',
    });
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
  });

  it('classifies a DevEUI used by another device, without logging TTI’s message', async () => {
    const { service } = build(() => taken('end_device_euis_taken'));
    const error: unknown = await service
      .createOtaaDevice(input)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TtiProvisioningError);
    expect(error).toMatchObject({
      kind: 'eui_taken',
      ttiName: 'end_device_euis_taken',
    });
    expect((error as Error).message).not.toContain('secret detail');
  });

  it('is not configured without a cluster for the region', async () => {
    const { service, calls } = build(() => ok);
    await expect(
      service.createOtaaDevice({
        ...input,
        profile: { ...profile, region: 'nam1' },
      }),
    ).rejects.toMatchObject({ kind: 'not_configured' });
    expect(calls).toHaveLength(0);
  });

  it('does not retry a rate-limited request', async () => {
    const { service, calls } = build(() => ({ status: 429 }));
    await expect(
      service.deviceExists({ applicationId: 'a-b', deviceId: 'd-1' }),
    ).rejects.toMatchObject({ kind: 'unavailable' });
    expect(calls).toHaveLength(1);
  });

  it('stops once the deadline has passed', async () => {
    const { service, calls } = build(() => ok);
    const signal = AbortSignal.abort();
    await expect(service.createOtaaDevice(input, signal)).rejects.toMatchObject(
      {
        kind: 'unavailable',
      },
    );
    expect(calls.filter((c) => c.method !== 'DELETE')).toHaveLength(0);
  });
});

describe('TtiProvisioningService.findDeviceByDevEui', () => {
  it('returns the application holding the exact DevEUI, skipping apps it cannot read', async () => {
    const { service, calls } = build((call) => {
      if (call.url.includes('/legacy/')) return { status: 403, body: {} };
      if (call.url.includes('/gone/')) return { status: 404, body: {} };
      if (call.url.includes('/netvox-ra02a/')) {
        return {
          status: 200,
          body: {
            end_devices: [
              { ids: { device_id: 'other', dev_eui: '00137A10000441DFFF' } },
              { ids: { device_id: 'smoke-1', dev_eui: '00137A10000441DF' } },
            ],
          },
        };
      }
      return { status: 200, body: { end_devices: [] } };
    });

    await expect(
      service.findDeviceByDevEui('00137a10000441df', [
        'legacy',
        'gone',
        'cw-air-th',
        'netvox-ra02a',
      ]),
    ).resolves.toEqual({ applicationId: 'netvox-ra02a', deviceId: 'smoke-1' });
    expect(calls[0].url).toContain('dev_eui_contains=00137A10000441DF');
    expect(calls[0].url).toContain('field_mask=name');
  });

  it('fails instead of reporting "not found" when no application can be read', async () => {
    const { service } = build(() => ({ status: 403, body: {} }));
    await expect(
      service.findDeviceByDevEui('00137A10000441DF', ['a-b-c', 'd-e-f']),
    ).rejects.toMatchObject({ kind: 'forbidden' });
  });

  it('surfaces a rejected search rather than skipping it', async () => {
    const { service } = build(() => ({ status: 400, body: {} }));
    await expect(
      service.findDeviceByDevEui('00137A10000441DF', ['a-b-c']),
    ).rejects.toMatchObject({ kind: 'invalid' });
  });

  it('returns null when no application has it', async () => {
    const { service } = build(() => ok);
    await expect(
      service.findDeviceByDevEui('00137A10000441DF', ['a-b-c']),
    ).resolves.toBeNull();
  });
});

describe('TtiProvisioningService.inspectDevice', () => {
  const ref = { applicationId: 'netvox-ra02a', deviceId: 'smoke-1' };

  it('reads the cluster, the stored AppKey and completeness', async () => {
    const { service } = build((call) => {
      if (call.url.startsWith(IDENTITY)) {
        return {
          status: 200,
          body: {
            join_server_address: 'cropwatch.as1.cloud.thethings.industries',
          },
        };
      }
      if (call.url.includes('/js/')) {
        return {
          status: 200,
          body: { root_keys: { app_key: { key: APP_KEY.toLowerCase() } } },
        };
      }
      return ok;
    });
    await expect(service.inspectDevice(ref)).resolves.toEqual({
      region: 'as1',
      appKey: APP_KEY,
      complete: true,
    });
  });

  it('reports an unfinished registration', async () => {
    const { service } = build((call) => {
      if (call.url.startsWith(IDENTITY)) {
        return {
          status: 200,
          body: {
            join_server_address: 'cropwatch.as1.cloud.thethings.industries',
          },
        };
      }
      return { status: 404, body: {} };
    });
    await expect(service.inspectDevice(ref)).resolves.toEqual({
      region: 'as1',
      appKey: null,
      complete: false,
    });
  });

  it('does not trust a Join Server it does not know', async () => {
    const { service, calls } = build(() => ({
      status: 200,
      body: { join_server_address: 'join.example.com' },
    }));
    await expect(service.inspectDevice(ref)).resolves.toEqual({
      region: null,
      appKey: null,
      complete: false,
    });
    expect(calls).toHaveLength(1);
  });
});
