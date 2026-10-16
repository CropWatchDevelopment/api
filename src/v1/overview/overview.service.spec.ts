import { InternalServerErrorException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { SupabaseService } from '../../supabase/supabase.service';
import { AccessService } from '../common/authz';
import { GatewayService } from '../gateway/gateway.service';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import {
  OVERVIEW_FEED_LIMIT,
  OverviewService,
  type OverviewRpcResult,
} from './overview.service';

const customer: AuthenticatedUser = {
  sub: 'user-123',
  email: 'farmer@example.com',
  isStaff: false,
};
const staff: AuthenticatedUser = {
  sub: 'staff-1',
  email: 'kevin@cropwatch.io',
  isStaff: true,
};

function rpcResult(
  overrides: Partial<OverviewRpcResult> = {},
): OverviewRpcResult {
  return {
    generated_at: '2026-10-15T09:05:00.000Z',
    since: '2026-10-14T09:05:00.000Z',
    devices: {
      total: 48,
      online: 44,
      offline: 4,
      last_data_at: '2026-10-15T09:04:20.000Z',
      location_count: 6,
    },
    locations: [
      { location_id: 1, name: 'Cold Room 1', total: 8, online: 7, alerts: 3 },
      { location_id: null, name: null, total: 1, online: 1, alerts: 0 },
    ],
    types: [{ data_table: 'cw_air_data', total: 21 }],
    alerts: {
      count: 7,
      previous_count: 10,
      active: 2,
      top_devices: [
        {
          dev_eui: '0025CA0000005704',
          device_name: 'Cold room probe',
          location_id: 1,
          location_name: 'Cold Room 1',
          count: 4,
        },
      ],
    },
    reports: {
      count: 2,
      last_at: '2026-10-15T06:00:00.000Z',
      recent: [
        {
          dev_eui: '0025CA0000005704',
          device_name: 'Cold room probe',
          location_id: 1,
          location_name: 'Cold Room 1',
          file: '2026_10_04-2026_10_10.pdf',
          created_at: '2026-10-15T06:00:00.000Z',
        },
      ],
    },
    uplinks: { count: 13800, delivered: 13650, expected: 13780 },
    hourly: [{ hour: '2026-10-15T08:00:00.000Z', reporting: 44 }],
    notes: [
      {
        id: 1,
        dev_eui: '0025CA0000005704',
        device_name: 'Cold room probe',
        location_id: 1,
        location_name: 'Cold Room 1',
        title: 'Door seal',
        note: 'Replaced the door seal.',
        created_by: 'kevin@cropwatch.io',
        created_at: '2026-10-15T07:00:00.000Z',
      },
      {
        id: 2,
        dev_eui: '0025CA0000005705',
        device_name: null,
        location_id: null,
        location_name: null,
        title: 'Irrigation',
        note: null,
        created_by: 'farmer@example.com',
        created_at: '2026-10-14T07:00:00.000Z',
      },
    ],
    feed: {
      counts: { alert: 3, device: 1, report: 1, data: 2 },
      items: [
        {
          kind: 'alert_resolved',
          at: '2026-10-15T08:20:00.000Z',
          dev_eui: '0025CA0000005704',
          device_name: 'Cold room probe',
          location_id: 1,
          location_name: 'Cold Room 1',
          rule_name: 'Cold room temperature',
          triggered_at: '2026-10-15T07:08:00.000Z',
        },
        {
          kind: 'data_hour',
          at: '2026-10-15T09:00:00.000Z',
          reporting: 44,
          total: 48,
        },
      ],
    },
    attention: {
      offline: [{ location_id: 1, name: 'Cold Room 1', count: 1 }],
      active_alerts: [{ location_id: 1, name: 'Cold Room 1', count: 2 }],
    },
    ...overrides,
  };
}

describe('OverviewService', () => {
  let service: OverviewService;
  let rpc: jest.Mock;
  let accessService: { listAccessibleDevices: jest.Mock };
  let gatewayService: { listVisible: jest.Mock };

  const rpcParams = () =>
    (rpc.mock.calls as [string, Record<string, unknown>][])[0][1];

  beforeEach(async () => {
    rpc = jest.fn().mockResolvedValue({ data: rpcResult(), error: null });
    accessService = {
      listAccessibleDevices: jest.fn().mockResolvedValue([
        { devEui: '0025CA0000005704', canView: true },
        { devEui: '0025CA0000005705', canView: true },
        // A Disabled grant: listed, but not readable.
        { devEui: '0025CA0000009999', canView: false },
      ]),
    };
    gatewayService = {
      listVisible: jest.fn().mockResolvedValue([
        { gateway_id: 'gw-1', is_online: true },
        { gateway_id: 'gw-2', is_online: true },
        { gateway_id: 'gw-3', is_online: false },
      ]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OverviewService,
        { provide: SupabaseService, useValue: { getClient: () => ({ rpc }) } },
        { provide: AccessService, useValue: accessService },
        { provide: GatewayService, useValue: gatewayService },
      ],
    }).compile();

    service = module.get(OverviewService);
  });

  it('aggregates only the devices the caller can view', async () => {
    await service.getOverview(customer, '24h');

    expect(accessService.listAccessibleDevices).toHaveBeenCalledWith(customer);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('cw_overview', {
      p_dev_euis: ['0025CA0000005704', '0025CA0000005705'],
      p_hours: 24,
      p_feed_limit: OVERVIEW_FEED_LIMIT,
    });
  });

  it.each([
    ['24h', 24],
    ['7d', 168],
    ['30d', 720],
  ] as const)('passes %s as %i hours', async (range, hours) => {
    const result = await service.getOverview(customer, range);

    expect(rpcParams()).toMatchObject({ p_hours: hours });
    expect(result.range).toBe(range);
  });

  it('still asks the database when the caller has no devices', async () => {
    accessService.listAccessibleDevices.mockResolvedValue([]);

    await service.getOverview(customer, '24h');

    expect(rpcParams()).toMatchObject({ p_dev_euis: [] });
  });

  it('counts the gateways GET /v1/gateway lists for the caller', async () => {
    const result = await service.getOverview(customer, '24h');

    expect(gatewayService.listVisible).toHaveBeenCalledWith(customer);
    expect(result.gateways).toEqual({ total: 3, online: 2 });
  });

  it('maps the database payload to the API shape', async () => {
    const result = await service.getOverview(customer, '7d');

    expect(result).toMatchObject({
      range: '7d',
      generatedAt: '2026-10-15T09:05:00.000Z',
      since: '2026-10-14T09:05:00.000Z',
      devices: {
        total: 48,
        online: 44,
        offline: 4,
        lastDataAt: '2026-10-15T09:04:20.000Z',
        locationCount: 6,
      },
      alerts: {
        count: 7,
        previousCount: 10,
        active: 2,
        topDevices: [
          {
            devEui: '0025CA0000005704',
            deviceName: 'Cold room probe',
            locationId: 1,
            locationName: 'Cold Room 1',
            count: 4,
          },
        ],
      },
      reports: {
        count: 2,
        lastAt: '2026-10-15T06:00:00.000Z',
        recent: [
          {
            devEui: '0025CA0000005704',
            deviceName: 'Cold room probe',
            locationId: 1,
            locationName: 'Cold Room 1',
            file: '2026_10_04-2026_10_10.pdf',
            createdAt: '2026-10-15T06:00:00.000Z',
          },
        ],
      },
      uplinks: { count: 13800, delivered: 13650, expected: 13780 },
      hourly: [{ hour: '2026-10-15T08:00:00.000Z', reporting: 44 }],
      locations: [
        { locationId: 1, name: 'Cold Room 1', total: 8, online: 7, alerts: 3 },
        { locationId: null, name: null, total: 1, online: 1, alerts: 0 },
      ],
      types: [{ dataTable: 'cw_air_data', total: 21 }],
      attention: {
        offline: [{ locationId: 1, name: 'Cold Room 1', count: 1 }],
        activeAlerts: [{ locationId: 1, name: 'Cold Room 1', count: 2 }],
      },
    });
    expect(result.feed.counts).toEqual({
      alert: 3,
      device: 1,
      report: 1,
      data: 2,
    });
    expect(result.feed.items).toEqual([
      {
        kind: 'alert_resolved',
        at: '2026-10-15T08:20:00.000Z',
        devEui: '0025CA0000005704',
        deviceName: 'Cold room probe',
        locationId: 1,
        locationName: 'Cold Room 1',
        ruleName: 'Cold room temperature',
        triggeredAt: '2026-10-15T07:08:00.000Z',
      },
      // Fields the database left out stay out (no undefined keys).
      {
        kind: 'data_hour',
        at: '2026-10-15T09:00:00.000Z',
        reporting: 44,
        total: 48,
      },
    ]);
  });

  it('maps a payload from before 035 without location ids or top devices', async () => {
    const legacy = rpcResult();
    delete legacy.alerts.top_devices;
    delete legacy.reports.recent[0].location_id;
    delete legacy.notes[0].location_id;
    delete legacy.feed.items[0].location_id;
    rpc.mockResolvedValue({ data: legacy, error: null });

    const result = await service.getOverview(customer, '24h');

    expect(result.alerts.topDevices).toEqual([]);
    expect(result.reports.recent[0].locationId).toBeNull();
    expect(result.notes[0].locationId).toBeNull();
    expect(result.feed.items[0]).not.toHaveProperty('locationId');
  });

  it('hides a staff note author from customers', async () => {
    const result = await service.getOverview(customer, '24h');

    expect(result.notes[0]).toMatchObject({
      title: 'Door seal',
      author: null,
      authorIsStaff: true,
    });
    expect(result.notes[1]).toMatchObject({
      author: 'farmer@example.com',
      authorIsStaff: false,
    });
    expect(JSON.stringify(result)).not.toContain('kevin@cropwatch.io');
  });

  it('shows staff authors to staff', async () => {
    const result = await service.getOverview(staff, '24h');

    expect(result.notes[0]).toMatchObject({
      author: 'kevin@cropwatch.io',
      authorIsStaff: true,
    });
  });

  it('throws a 500 when the database call fails', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'function cw_overview does not exist', code: '42883' },
    });

    await expect(service.getOverview(customer, '24h')).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });
});
