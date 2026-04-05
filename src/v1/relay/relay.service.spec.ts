import { ConfigService } from '@nestjs/config';
import { RelayCommandLockService } from './relay-command-lock.service';
import { RelayService } from './relay.service';
import { SupabaseService } from '../../supabase/supabase.service';

describe('RelayService', () => {
  const deviceContext = {
    applicationId: 'dragino-ja-lt-22222',
    device: {
      battery_changed_at: null,
      battery_level: null,
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
    permissionLevel: 2,
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
        getClient: jest.fn(() =>
          clientOverride ?? {
            from: jest.fn(),
          },
        ),
      } as unknown as SupabaseService,
    );
  }

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('returns immediately when the relay is already in the requested state', async () => {
    const service = createService();

    jest
      .spyOn(service as any, 'loadRelayDeviceContext')
      .mockResolvedValue(deviceContext);
    jest.spyOn(service as any, 'findLatestRelayRow').mockResolvedValue({
      ...relayRow,
      relay_1: true,
    });

    await expect(
      service.updateRelay(
        { sub: 'user-1', email: 'user@example.com' },
        'Bearer token-1',
        'a8404194635a05fb',
        { relay: 1, targetState: 'on' },
      ),
    ).resolves.toMatchObject({
      confirmed: true,
      message: 'Relay 1 is already on',
    });
  });

  it('returns success after queueing the downlink when confirmation waiting is disabled', async () => {
    const service = createService({
      PRIVATE_TTI_API_KEY: 'tti-secret',
      PRIVATE_TTI_BASE_URL: 'https://tti.example.com',
      PRIVATE_TTI_RELAY_CONFIRMATION_POLL_MS: '250',
      PRIVATE_TTI_RELAY_CONFIRMATION_TIMEOUT_MS: '1000',
    });

    jest
      .spyOn(service as any, 'loadRelayDeviceContext')
      .mockResolvedValue(deviceContext);
    jest
      .spyOn(service as any, 'findLatestRelayRow')
      .mockResolvedValue(relayRow);

    const originalFetch = global.fetch;
    global.fetch = jest.fn(async () =>
      new Response(JSON.stringify({}), {
        headers: {
          'content-type': 'application/json',
        },
        status: 200,
      })) as typeof fetch;

    await expect(
      service.updateRelay(
        { sub: 'user-1', email: 'user@example.com' },
        'Bearer token-1',
        'A8404194635A05FB',
        { relay: 1, targetState: 'on' },
      ),
    ).resolves.toMatchObject({
      confirmed: true,
      dev_eui: 'A8404194635A05FB',
      message: 'Relay 1 confirmed on by TTI',
      relay: 1,
      targetState: 'on',
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);

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
    global.fetch = jest.fn(async (_input, init) => {
      expect(init?.method).toBe('POST');
      expect(JSON.parse(String(init?.body))).toEqual({
        downlinks: [
          {
            confirmed: false,
            correlation_ids: expect.arrayContaining([
              'cropwatch:relay:1',
              'cropwatch:kind:pulse',
              'cropwatch:target:on',
              'cropwatch:duration_ms:1000',
            ]),
            f_port: 2,
            frm_payload: 'BQERA+g=',
            priority: 'NORMAL',
          },
        ],
      });

      return new Response(JSON.stringify({}), {
        headers: {
          'content-type': 'application/json',
        },
        status: 200,
      });
    }) as typeof fetch;

    await expect(
      service.pulseRelay(
        { sub: 'user-1', email: 'user@example.com' },
        'Bearer token-1',
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
        { sub: 'user-1', email: 'user@example.com' },
        'Bearer token-1',
        'A8404194635A05FB',
        { durationSeconds: 60, relay: 1 },
      ),
    ).rejects.toMatchObject({
      message: 'Timed relay pulse requires the target relay to currently be off',
      response: {
        message: 'Timed relay pulse requires the target relay to currently be off',
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

    await expect(
      (service as any).persistRelayConfirmation({
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
});
