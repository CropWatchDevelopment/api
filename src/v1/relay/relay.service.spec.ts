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

  function createService(configValues: Record<string, string> = {}) {
    return new RelayService(
      {
        get: jest.fn((key: string) => configValues[key]),
      } as unknown as ConfigService,
      new RelayCommandLockService(),
      {
        getClient: jest.fn(() => ({
          from: jest.fn(),
        })),
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
});
