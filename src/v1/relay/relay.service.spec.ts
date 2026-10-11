import { ConfigService } from '@nestjs/config';
import { RelayCommandLockService } from './relay-command-lock.service';
import { RelayService } from './relay.service';
import { SupabaseService } from '../../supabase/supabase.service';
import { NotFoundException } from '@nestjs/common';
import { AccessService, type DeviceAccess } from '../common/authz';

function requestUrlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input;
  }

  return input instanceof URL ? input.href : input.url;
}

/** Private members these tests reach into. */
type RelayServiceInternals = {
  logger: { error: (message: string, ...rest: unknown[]) => void };
  findRelayCommands: (
    devEui: string,
    from: Date,
    to: Date,
  ) => Promise<unknown[]>;
  readAllPages: (
    page: (first: number, last: number) => PromiseLike<unknown>,
    devEui: string,
  ) => Promise<unknown[]>;
};

function internals(service: RelayService): RelayServiceInternals {
  return service as unknown as RelayServiceInternals;
}

describe('RelayService', () => {
  const deviceContext = {
    applicationId: 'dragino-ja-lt-22222',
    device: {
      battery_changed_at: null,
      dev_eui: 'A8404194635A05FB',
      group: null,
      installed_at: null,
      last_data_updated_at: null,
      lat: null,
      location_id: 10,
      long: null,
      name: 'Relay Device',
      primary_data: null,
      report_endpoint: null,
      secondary_data: null,
      sensor_serial: null,
      sensor1_serial: null,
      sensor2_serial: null,
      tti_name: 'eui-a8404194635a05fb',
      type: 1,
      upload_interval: null,
      user_id: 'user-1',
      warranty_start_date: null,
    },
    deviceId: 'eui-a8404194635a05fb',
    access: {
      exists: true,
      devEui: 'A8404194635A05FB',
      locationId: 10,
      orgId: null,
      ownerId: 'user-1',
      isStaff: false,
      isOwner: false,
      level: 2,
      orgRole: null,
      parentRead: false,
      canRead: true,
    } satisfies DeviceAccess,
  };

  const relayRow = {
    created_at: '2026-04-05T02:34:00.000Z',
    dev_eui: 'A8404194635A05FB',
    id: 10,
    last_update: '2026-04-05T02:34:00.000Z',
    relay_1: false,
    relay_2: false,
  };

  function createService(
    configValues: Record<string, string> = {},
    clientOverride?: { from: jest.Mock },
  ) {
    return new RelayService(
      {
        get: jest.fn((key: string) => configValues[key]),
      } as unknown as ConfigService,
      new RelayCommandLockService(),
      {
        getClient: jest.fn(
          () =>
            clientOverride ?? {
              // Commands are logged after TTI accepts them.
              from: jest.fn(() => ({
                insert: jest.fn().mockResolvedValue({ error: null }),
              })),
            },
        ),
      } as unknown as SupabaseService,
      { getDeviceAccess: jest.fn() } as unknown as AccessService,
    );
  }

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('sends the command even when the stored state already shows the target', async () => {
    // cw_relay_data only changes when the device reports; after a lost report
    // it is stale, so it must never decide whether a command goes out.
    const service = createService({
      PRIVATE_TTI_API_KEY: 'tti-secret',
      PRIVATE_TTI_BASE_URL: 'https://tti.example.com',
    });

    jest
      .spyOn(service as any, 'loadRelayDeviceContext')
      .mockResolvedValue(deviceContext);
    const findLatestRelayRow = jest
      .spyOn(service as any, 'findLatestRelayRow')
      .mockResolvedValue({ ...relayRow, relay_1: true });

    const originalFetch = global.fetch;
    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      expect(requestUrlOf(input)).toBe(
        'https://tti.example.com/api/v3/as/applications/dragino-ja-lt-22222/devices/eui-a8404194635a05fb/down/replace',
      );
      expect(JSON.parse(init?.body as string)).toMatchObject({
        downlinks: [{ f_port: 2, frm_payload: 'AwER' }],
      });

      return Promise.resolve(
        new Response(JSON.stringify({}), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        }),
      );
    }) as typeof fetch;

    await expect(
      service.updateRelay(
        { sub: 'user-1', email: 'user@example.com', isStaff: false },
        'a8404194635a05fb',
        { relay: 1, targetState: 'on' },
      ),
    ).resolves.toMatchObject({ queued: true, relay: 1, targetState: 'on' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(findLatestRelayRow).not.toHaveBeenCalled();

    global.fetch = originalFetch;
  });

  it('returns the latest relay row for users who can read the device', async () => {
    const service = createService();

    jest.spyOn(service as any, 'loadRelayDeviceContext').mockResolvedValue({
      ...deviceContext,
      access: { ...deviceContext.access, level: 3 },
    });
    jest
      .spyOn(service as any, 'findLatestRelayRow')
      .mockResolvedValue(relayRow);

    await expect(
      service.getLatestRelay(
        { sub: 'user-1', email: 'user@example.com', isStaff: false },
        'a8404194635a05fb',
      ),
    ).resolves.toEqual(relayRow);
  });

  it('returns the latest relay row for viewer-level users', async () => {
    const service = createService();

    jest.spyOn(service as any, 'loadRelayDeviceContext').mockResolvedValue({
      ...deviceContext,
      access: { ...deviceContext.access, level: 4 },
    });
    jest
      .spyOn(service as any, 'findLatestRelayRow')
      .mockResolvedValue(relayRow);

    await expect(
      service.getLatestRelay(
        { sub: 'user-1', email: 'user@example.com', isStaff: false },
        'a8404194635a05fb',
      ),
    ).resolves.toEqual(relayRow);
  });

  it('rejects latest relay reads when the user has no access to the device', async () => {
    const service = createService();

    // The 404 for invisible devices now happens inside the context loader
    // (central AccessService resolution).
    jest
      .spyOn(service as any, 'loadRelayDeviceContext')
      .mockRejectedValue(new NotFoundException('Device not found'));

    await expect(
      service.getLatestRelay(
        { sub: 'user-1', email: 'user@example.com', isStaff: false },
        'A8404194635A05FB',
      ),
    ).rejects.toMatchObject({
      message: 'Device not found',
      response: {
        message: 'Device not found',
        statusCode: 404,
      },
      status: 404,
    });
  });

  it('reports the command as queued, with the time it was sent', async () => {
    const service = createService({
      PRIVATE_TTI_API_KEY: 'tti-secret',
      PRIVATE_TTI_BASE_URL: 'https://tti.example.com',
    });

    jest
      .spyOn(service as any, 'loadRelayDeviceContext')
      .mockResolvedValue(deviceContext);
    jest
      .spyOn(service as any, 'findLatestRelayRow')
      .mockResolvedValue(relayRow);

    const originalFetch = global.fetch;
    global.fetch = jest.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({}), {
          headers: {
            'content-type': 'application/json',
          },
          status: 200,
        }),
      ),
    ) as typeof fetch;

    await expect(
      service.updateRelay(
        { sub: 'user-1', email: 'user@example.com', isStaff: false },
        'A8404194635A05FB',
        { relay: 1, targetState: 'on' },
      ),
    ).resolves.toMatchObject({
      confirmed: true,
      queued: true,
      dev_eui: 'A8404194635A05FB',
      message:
        'Relay 1 on command sent; waiting for the device to report its new state',
      relay: 1,
      requestedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) as string,
      targetState: 'on',
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);

    global.fetch = originalFetch;
  });

  it('asks the device for a status report without replacing the downlink queue', async () => {
    const service = createService({
      PRIVATE_TTI_API_KEY: 'tti-secret',
      PRIVATE_TTI_BASE_URL: 'https://tti.example.com',
    });

    jest
      .spyOn(service as any, 'loadRelayDeviceContext')
      .mockResolvedValue(deviceContext);

    const originalFetch = global.fetch;
    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      // push, not replace: a relay command still waiting must survive.
      expect(requestUrlOf(input)).toBe(
        'https://tti.example.com/api/v3/as/applications/dragino-ja-lt-22222/devices/eui-a8404194635a05fb/down/push',
      );
      expect(JSON.parse(init?.body as string)).toEqual({
        downlinks: [
          {
            confirmed: false,
            correlation_ids: expect.arrayContaining([
              'cropwatch:device:A8404194635A05FB',
              'cropwatch:kind:status',
            ]) as string[],
            f_port: 2,
            frm_payload: 'CP8=',
            priority: 'NORMAL',
          },
        ],
      });

      return Promise.resolve(
        new Response(JSON.stringify({}), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        }),
      );
    }) as typeof fetch;

    await expect(
      service.requestRelayStatus(
        { sub: 'user-1', email: 'user@example.com', isStaff: false },
        'a8404194635a05fb',
      ),
    ).resolves.toMatchObject({
      dev_eui: 'A8404194635A05FB',
      queued: true,
      requestedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) as string,
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);

    global.fetch = originalFetch;
  });

  it('only lets users who can control the relay request a status report', async () => {
    const service = createService({
      PRIVATE_TTI_API_KEY: 'tti-secret',
      PRIVATE_TTI_BASE_URL: 'https://tti.example.com',
    });

    jest.spyOn(service as any, 'loadRelayDeviceContext').mockResolvedValue({
      ...deviceContext,
      access: { ...deviceContext.access, level: 4 },
    });

    const originalFetch = global.fetch;
    global.fetch = jest.fn() as typeof fetch;

    await expect(
      service.requestRelayStatus(
        { sub: 'user-1', email: 'user@example.com', isStaff: false },
        'A8404194635A05FB',
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(global.fetch).not.toHaveBeenCalled();

    global.fetch = originalFetch;
  });

  it('queues a timed relay pulse using the current state of the other relay', async () => {
    const service = createService({
      PRIVATE_TTI_API_KEY: 'tti-secret',
      PRIVATE_TTI_BASE_URL: 'https://tti.example.com',
    });

    jest
      .spyOn(service as any, 'loadRelayDeviceContext')
      .mockResolvedValue(deviceContext);
    jest.spyOn(service as any, 'findLatestRelayRow').mockResolvedValue({
      ...relayRow,
      relay_1: false,
      relay_2: true,
    });

    const originalFetch = global.fetch;
    global.fetch = jest.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe('POST');
      expect(JSON.parse(init?.body as string)).toEqual({
        downlinks: [
          {
            confirmed: false,
            correlation_ids: expect.arrayContaining([
              'cropwatch:relay:1',
              'cropwatch:kind:pulse',
              'cropwatch:target:on',
              'cropwatch:duration_ms:1000',
            ]) as string[],
            f_port: 2,
            frm_payload: 'BQERA+g=',
            priority: 'NORMAL',
          },
        ],
      });

      return Promise.resolve(
        new Response(JSON.stringify({}), {
          headers: {
            'content-type': 'application/json',
          },
          status: 200,
        }),
      );
    }) as typeof fetch;

    await expect(
      service.pulseRelay(
        { sub: 'user-1', email: 'user@example.com', isStaff: false },
        'A8404194635A05FB',
        { durationSeconds: 1, relay: 1 },
      ),
    ).resolves.toMatchObject({
      confirmed: true,
      dev_eui: 'A8404194635A05FB',
      durationMs: 1000,
      durationSeconds: 1,
      message: 'Relay 1 pulse queued for 1 seconds',
      relay: 1,
      targetState: 'on',
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);

    global.fetch = originalFetch;
  });

  it('rejects timed relay pulses when the target relay is already on', async () => {
    const service = createService();

    jest
      .spyOn(service as any, 'loadRelayDeviceContext')
      .mockResolvedValue(deviceContext);
    jest.spyOn(service as any, 'findLatestRelayRow').mockResolvedValue({
      ...relayRow,
      relay_1: true,
      relay_2: false,
    });

    await expect(
      service.pulseRelay(
        { sub: 'user-1', email: 'user@example.com', isStaff: false },
        'A8404194635A05FB',
        { durationSeconds: 60, relay: 1 },
      ),
    ).rejects.toMatchObject({
      message:
        'Timed relay pulse requires the target relay to currently be off',
      response: {
        message:
          'Timed relay pulse requires the target relay to currently be off',
        statusCode: 409,
      },
      status: 409,
    });
  });

  it('accepts the TTI X-Downlink-Apikey header for webhook authentication', async () => {
    const service = createService({
      PRIVATE_TTI_WEBHOOK_TOKEN: 'tti-token',
    });

    const persistRelayConfirmation = jest
      .spyOn(service as any, 'persistRelayConfirmation')
      .mockResolvedValue({
        created_at: '2026-04-05T03:46:46.331128009Z',
        dev_eui: 'A8404194635A05FB',
        id: 42,
        last_update: '2026-04-05T03:46:46.331128009Z',
        relay_1: true,
        relay_2: true,
      });

    await expect(
      service.handleTtiUp(
        {
          data: {
            end_device_ids: {
              dev_eui: 'A8404194635A05FB',
            },
            received_at: '2026-04-05T03:46:46.331128009Z',
            uplink_message: {
              decoded_payload: {
                RO1_status: 'ON',
                RO2_status: 'ON',
              },
            },
          },
        },
        undefined,
        'tti-token',
      ),
    ).resolves.toMatchObject({
      processed: true,
      relay_1: true,
      relay_2: true,
    });

    expect(persistRelayConfirmation).toHaveBeenCalledTimes(1);
  });

  it('rejects webhook uplinks when PRIVATE_TTI_WEBHOOK_TOKEN is not configured', async () => {
    const service = createService();

    await expect(
      service.handleTtiUp(
        {
          data: {
            end_device_ids: {
              dev_eui: 'A8404194635A05FB',
            },
            received_at: '2026-04-05T03:46:46.331128009Z',
            uplink_message: {
              decoded_payload: {
                RO1_status: 'ON',
                RO2_status: 'ON',
              },
            },
          },
        },
        undefined,
        'any-token',
      ),
    ).rejects.toMatchObject({
      response: {
        message: 'Relay webhook is not configured',
        statusCode: 401,
      },
      status: 401,
    });
  });

  it('upserts an existing relay row by dev_eui instead of inserting a duplicate', async () => {
    const single = jest.fn().mockResolvedValue({
      data: {
        ...relayRow,
        last_update: '2026-04-05T04:23:55.360223162Z',
        relay_1: true,
      },
      error: null,
    });
    const select = jest.fn(() => ({
      single,
    }));
    const upsert = jest.fn(() => ({
      select,
    }));
    const client = {
      from: jest.fn(() => ({
        upsert,
      })),
    };
    const service = createService({}, client);

    jest
      .spyOn(service as any, 'findLatestRelayRow')
      .mockResolvedValue(relayRow);

    const persistRelayConfirmation = (
      service as unknown as {
        persistRelayConfirmation: (confirmation: {
          devEui: string;
          receivedAt: string;
          relay1?: boolean;
          relay2?: boolean;
        }) => Promise<unknown>;
      }
    ).persistRelayConfirmation.bind(service);

    await expect(
      persistRelayConfirmation({
        devEui: 'A8404194635A05FB',
        receivedAt: '2026-04-05T04:23:55.360223162Z',
        relay1: true,
        relay2: undefined,
      }),
    ).resolves.toMatchObject({
      created_at: relayRow.created_at,
      dev_eui: 'A8404194635A05FB',
      last_update: '2026-04-05T04:23:55.360223162Z',
      relay_1: true,
      relay_2: false,
    });

    expect(client.from).toHaveBeenCalledWith('cw_relay_data');
    expect(upsert).toHaveBeenCalledWith(
      {
        created_at: relayRow.created_at,
        dev_eui: 'A8404194635A05FB',
        last_update: '2026-04-05T04:23:55.360223162Z',
        relay_1: true,
        relay_2: false,
      },
      {
        onConflict: 'dev_eui',
      },
    );
  });

  describe('command log', () => {
    const user = { sub: 'user-1', email: 'user@example.com', isStaff: false };
    const ttiConfig = {
      PRIVATE_TTI_API_KEY: 'tti-secret',
      PRIVATE_TTI_BASE_URL: 'https://tti.example.com',
    };
    type InsertResult = { error: { code?: string; message: string } | null };

    function logClient(results: InsertResult[] = []) {
      const insert = jest.fn(() =>
        Promise.resolve(results.shift() ?? { error: null }),
      );
      return { client: { from: jest.fn(() => ({ insert })) }, insert };
    }

    function mockTti(status = 200) {
      const fetchMock = jest.fn(
        (_input: RequestInfo | URL, _init?: RequestInit) =>
          Promise.resolve(
            new Response(
              JSON.stringify(status === 200 ? {} : { message: 'no' }),
              {
                headers: { 'content-type': 'application/json' },
                status,
              },
            ),
          ),
      );
      const originalFetch = global.fetch;
      global.fetch = fetchMock;
      return {
        fetchMock,
        restore: () => {
          global.fetch = originalFetch;
        },
      };
    }

    /** The cropwatch:request:<uuid> correlation id sent to TTI. */
    function requestIdSentTo(
      fetchMock: ReturnType<typeof mockTti>['fetchMock'],
    ): string {
      const init = fetchMock.mock.calls[0][1];
      const body = JSON.parse(init?.body as string) as {
        downlinks: { correlation_ids: string[] }[];
      };
      const correlationId =
        body.downlinks[0].correlation_ids.find((id) =>
          id.startsWith('cropwatch:request:'),
        ) ?? '';
      return correlationId.slice('cropwatch:request:'.length);
    }

    it('logs a fixed command with who sent it and the TTI request id', async () => {
      const { client, insert } = logClient();
      const service = createService(ttiConfig, client);
      jest
        .spyOn(service as any, 'loadRelayDeviceContext')
        .mockResolvedValue(deviceContext);
      const tti = mockTti();

      const result = await service.updateRelay(user, 'a8404194635a05fb', {
        relay: 1,
        targetState: 'on',
      });

      expect(client.from).toHaveBeenCalledWith('cw_relay_commands');
      expect(insert).toHaveBeenCalledWith({
        dev_eui: 'A8404194635A05FB',
        sent_at: result.requestedAt,
        command: 'fixed',
        relay: 1,
        target_state: 'on',
        requested_by: 'user-1',
        request_id: requestIdSentTo(tti.fetchMock),
      });
      expect(requestIdSentTo(tti.fetchMock)).toMatch(/^[0-9a-f-]{36}$/);

      tti.restore();
    });

    it('logs a pulse with its duration', async () => {
      const { client, insert } = logClient();
      const service = createService(ttiConfig, client);
      jest
        .spyOn(service as any, 'loadRelayDeviceContext')
        .mockResolvedValue(deviceContext);
      jest
        .spyOn(service as any, 'findLatestRelayRow')
        .mockResolvedValue({ ...relayRow, relay_1: false, relay_2: true });
      const tti = mockTti();

      await service.pulseRelay(user, 'A8404194635A05FB', {
        durationSeconds: 90,
        relay: 1,
      });

      expect(insert).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'pulse',
          relay: 1,
          target_state: 'on',
          duration_seconds: 90,
          request_id: requestIdSentTo(tti.fetchMock),
        }),
      );

      tti.restore();
    });

    it('logs a status request without a relay or target', async () => {
      const { client, insert } = logClient();
      const service = createService(ttiConfig, client);
      jest
        .spyOn(service as any, 'loadRelayDeviceContext')
        .mockResolvedValue(deviceContext);
      const tti = mockTti();

      const result = await service.requestRelayStatus(user, 'A8404194635A05FB');

      expect(insert).toHaveBeenCalledWith({
        dev_eui: 'A8404194635A05FB',
        sent_at: result.requestedAt,
        command: 'status',
        requested_by: 'user-1',
        request_id: requestIdSentTo(tti.fetchMock),
      });

      tti.restore();
    });

    it('still reports the command as sent when it cannot be logged', async () => {
      const { client, insert } = logClient([
        {
          error: {
            code: '42P01',
            message: 'relation "cw_relay_commands" does not exist',
          },
        },
      ]);
      const service = createService(ttiConfig, client);
      jest
        .spyOn(service as any, 'loadRelayDeviceContext')
        .mockResolvedValue(deviceContext);
      const logError = jest
        .spyOn(internals(service).logger, 'error')
        .mockImplementation(() => undefined);
      const tti = mockTti();

      await expect(
        service.updateRelay(user, 'A8404194635A05FB', {
          relay: 1,
          targetState: 'off',
        }),
      ).resolves.toMatchObject({ queued: true });
      expect(insert).toHaveBeenCalledTimes(1);
      expect(logError).toHaveBeenCalledWith(
        'Failed to record relay fixed command for A8404194635A05FB',
        'relation "cw_relay_commands" does not exist',
      );

      tti.restore();
    });

    it('survives a log insert that throws', async () => {
      const insert = jest.fn(() => Promise.reject(new Error('socket hang up')));
      const service = createService(ttiConfig, {
        from: jest.fn(() => ({ insert })),
      });
      jest
        .spyOn(service as any, 'loadRelayDeviceContext')
        .mockResolvedValue(deviceContext);
      jest
        .spyOn(internals(service).logger, 'error')
        .mockImplementation(() => undefined);
      const tti = mockTti();

      await expect(
        service.requestRelayStatus(user, 'A8404194635A05FB'),
      ).resolves.toMatchObject({ queued: true });

      tti.restore();
    });

    it('keeps the command without a name when the caller has no profile row', async () => {
      const { client, insert } = logClient([
        {
          error: { code: '23503', message: 'violates foreign key constraint' },
        },
        { error: null },
      ]);
      const service = createService(ttiConfig, client);
      jest
        .spyOn(service as any, 'loadRelayDeviceContext')
        .mockResolvedValue(deviceContext);
      const tti = mockTti();

      await service.updateRelay(user, 'A8404194635A05FB', {
        relay: 2,
        targetState: 'on',
      });

      expect(insert).toHaveBeenCalledTimes(2);
      expect(insert).toHaveBeenLastCalledWith(
        expect.objectContaining({ command: 'fixed', requested_by: null }),
      );

      tti.restore();
    });

    it('logs nothing when TTI rejects the command', async () => {
      const { client, insert } = logClient();
      const service = createService(ttiConfig, client);
      jest
        .spyOn(service as any, 'loadRelayDeviceContext')
        .mockResolvedValue(deviceContext);
      const tti = mockTti(403);

      await expect(
        service.updateRelay(user, 'A8404194635A05FB', {
          relay: 1,
          targetState: 'on',
        }),
      ).rejects.toMatchObject({ status: 502 });
      expect(insert).not.toHaveBeenCalled();

      tti.restore();
    });
  });

  describe('getRelayHistory', () => {
    const user = { sub: 'user-1', email: 'user@example.com', isStaff: false };
    const day = {
      startDate: new Date('2026-10-10T00:00:00.000Z'),
      endDate: new Date('2026-10-10T23:59:59.000Z'),
    };

    /** A PostgREST builder whose terminal call resolves to `result`. */
    function queryChain(result: unknown) {
      const chain: Record<string, jest.Mock> = {};
      for (const method of [
        'select',
        'eq',
        'gte',
        'lte',
        'lt',
        'order',
        'limit',
      ]) {
        chain[method] = jest.fn(() => chain);
      }
      chain.range = jest.fn(() => Promise.resolve(result));
      chain.maybeSingle = jest.fn(() => Promise.resolve(result));
      return chain;
    }

    it('refuses ranges over 31 days before touching the database', async () => {
      const service = createService();
      const loadContext = jest.spyOn(service as any, 'loadRelayDeviceContext');

      await expect(
        service.getRelayHistory(user, 'A8404194635A05FB', {
          startDate: new Date('2026-09-01T00:00:00.000Z'),
          endDate: new Date('2026-10-10T00:00:00.000Z'),
        }),
      ).rejects.toMatchObject({ status: 400 });
      expect(loadContext).not.toHaveBeenCalled();
    });

    it('hides relays the user cannot see', async () => {
      const service = createService();
      jest
        .spyOn(service as any, 'loadRelayDeviceContext')
        .mockRejectedValue(new NotFoundException('Device not found'));

      await expect(
        service.getRelayHistory(user, 'A8404194635A05FB', day),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('merges the reports and commands into one timeline', async () => {
      jest.useFakeTimers({ now: new Date('2026-10-10T12:00:00.000Z') });
      const service = createService();
      jest
        .spyOn(service as any, 'loadRelayDeviceContext')
        .mockResolvedValue(deviceContext);
      const before = jest
        .spyOn(service as any, 'findRelayReportBefore')
        .mockResolvedValue({
          id: 1,
          reported_at: '2026-10-09T23:50:00.000Z',
          relay_1: false,
          relay_2: false,
        });
      const reports = jest
        .spyOn(service as any, 'findRelayReports')
        .mockResolvedValue([
          {
            id: 2,
            reported_at: '2026-10-10T11:00:04.000Z',
            relay_1: true,
            relay_2: false,
          },
        ]);
      const commands = jest
        .spyOn(service as any, 'findRelayCommands')
        .mockResolvedValue([
          {
            id: 3,
            sent_at: '2026-10-10T11:00:00.000Z',
            command: 'fixed',
            relay: 1,
            target_state: 'on',
            duration_seconds: null,
            requested_by_name: 'Kevin Cantrell',
          },
        ]);

      const entries = await service.getRelayHistory(
        user,
        'a8404194635a05fb',
        day,
      );

      // Read up to now (not the end of the day): nothing later exists yet.
      const evaluatedAt = new Date('2026-10-10T12:00:00.000Z');
      expect(before).toHaveBeenCalledWith('A8404194635A05FB', day.startDate);
      expect(reports).toHaveBeenCalledWith(
        'A8404194635A05FB',
        day.startDate,
        evaluatedAt,
      );
      expect(commands).toHaveBeenCalledWith(
        'A8404194635A05FB',
        day.startDate,
        evaluatedAt,
      );
      expect(entries).toEqual([
        expect.objectContaining({
          id: 'report:2',
          kind: 'state_change',
          changed_relays: [1],
        }),
        expect.objectContaining({
          id: 'command:3',
          kind: 'command',
          outcome: 'confirmed',
          requested_by: 'Kevin Cantrell',
        }),
      ]);
    });

    it('returns an empty timeline for a range that has not started yet', async () => {
      jest.useFakeTimers({ now: new Date('2026-10-10T12:00:00.000Z') });
      const service = createService();
      jest
        .spyOn(service as any, 'loadRelayDeviceContext')
        .mockResolvedValue(deviceContext);
      const reports = jest.spyOn(service as any, 'findRelayReports');

      await expect(
        service.getRelayHistory(user, 'A8404194635A05FB', {
          startDate: new Date('2026-10-11T00:00:00.000Z'),
          endDate: new Date('2026-10-11T12:00:00.000Z'),
        }),
      ).resolves.toEqual([]);
      expect(reports).not.toHaveBeenCalled();
    });

    it('reads commands with the requester name and drops malformed rows', async () => {
      const chain = queryChain({
        data: [
          {
            id: 1,
            sent_at: '2026-10-10T11:00:00.000Z',
            command: 'fixed',
            relay: 1,
            target_state: 'on',
            duration_seconds: null,
            requester: { full_name: 'Kevin Cantrell', username: 'kevin' },
          },
          {
            id: 2,
            sent_at: '2026-10-10T11:01:00.000Z',
            command: 'fixed',
            relay: null,
            target_state: 'on',
            duration_seconds: null,
            requester: null,
          },
        ],
        error: null,
      });
      const service = createService({}, { from: jest.fn(() => chain) });

      const commands = await internals(service).findRelayCommands(
        'A8404194635A05FB',
        day.startDate,
        day.endDate,
      );

      expect(chain.select).toHaveBeenCalledWith(
        expect.stringContaining('requester:requested_by(full_name, username)'),
      );
      expect(chain.eq).toHaveBeenCalledWith('dev_eui', 'A8404194635A05FB');
      expect(commands).toEqual([
        expect.objectContaining({ id: 1, requested_by_name: 'Kevin Cantrell' }),
      ]);
    });

    it('reads long ranges page by page', async () => {
      const service = createService();
      const page = jest
        .fn()
        .mockResolvedValueOnce({
          data: Array.from({ length: 1000 }, (_, id) => ({ id })),
          error: null,
        })
        .mockResolvedValueOnce({ data: [{ id: 1000 }], error: null });

      const rows = await internals(service).readAllPages(
        page,
        'A8404194635A05FB',
      );

      expect(page).toHaveBeenNthCalledWith(1, 0, 999);
      expect(page).toHaveBeenNthCalledWith(2, 1000, 1999);
      expect(rows).toHaveLength(1001);
    });

    it('fails loudly when a history read fails', async () => {
      const service = createService();
      jest
        .spyOn(internals(service).logger, 'error')
        .mockImplementation(() => undefined);
      const page = jest
        .fn()
        .mockResolvedValue({ data: null, error: { message: 'timeout' } });

      await expect(
        internals(service).readAllPages(page, 'A8404194635A05FB'),
      ).rejects.toMatchObject({ status: 500 });
    });
  });
});
