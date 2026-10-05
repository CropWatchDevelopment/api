import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { CONNECTED_WINDOW_HOURS, GatewayService } from './gateway.service';
import { SupabaseService } from '../../supabase/supabase.service';
import { AccessService, Action } from '../common/authz';
import type { AuthenticatedUser } from '../auth/authenticated-user';

type Call = { method: string; args: unknown[] };
type Result = { data: unknown; error: unknown };

/**
 * Chainable, thenable stand-in for the Supabase query builder. Each
 * `from(table)` pops the next queued result for that table; every chained
 * call is recorded so tests can assert filters.
 */
function createFakeClient(results: Record<string, Result[]>) {
  const queries: { table: string; calls: Call[] }[] = [];
  const chainMethods = [
    'select',
    'eq',
    'in',
    'gte',
    'lt',
    'lte',
    'or',
    'order',
    'range',
    'delete',
    'upsert',
    'insert',
  ];

  const client = {
    from: jest.fn((table: string) => {
      const queue = results[table] ?? [];
      const result = queue.shift() ?? { data: [], error: null };
      const record = { table, calls: [] as Call[] };
      queries.push(record);
      const query: Record<string, unknown> = {};
      for (const method of chainMethods) {
        query[method] = jest.fn((...args: unknown[]) => {
          record.calls.push({ method, args });
          return query;
        });
      }
      query.maybeSingle = jest.fn(() => Promise.resolve(result));
      query.then = (
        resolve: (value: Result) => unknown,
        reject: (reason: unknown) => unknown,
      ) => Promise.resolve(result).then(resolve, reject);
      return query;
    }),
  };

  const queriesFor = (table: string) =>
    queries.filter((q) => q.table === table);

  return { client, queries, queriesFor };
}

const user: AuthenticatedUser = {
  sub: 'user-123',
  email: null,
  isStaff: false,
};

function gatewayRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 11,
    gateway_id: 'gw-001',
    gateway_name: 'North Gateway',
    is_online: true,
    is_public: false,
    org_id: null,
    created_at: '2026-04-21T00:00:00.000Z',
    updated_at: null,
    last_seen_at: null,
    status_checked_at: null,
    connected_at: null,
    cw_gateways_owners: [],
    ...overrides,
  };
}

describe('GatewayService', () => {
  let service: GatewayService;
  let supabaseService: { getClient: jest.Mock };
  let accessService: {
    getManagedOrgIds: jest.Mock;
    assertDeviceAccess: jest.Mock;
    listAccessibleDevices: jest.Mock;
  };

  beforeEach(async () => {
    supabaseService = { getClient: jest.fn() };
    accessService = {
      getManagedOrgIds: jest.fn().mockResolvedValue([]),
      assertDeviceAccess: jest.fn(),
      listAccessibleDevices: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GatewayService,
        { provide: SupabaseService, useValue: supabaseService },
        { provide: AccessService, useValue: accessService },
      ],
    }).compile();

    service = module.get<GatewayService>(GatewayService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
    expect(CONNECTED_WINDOW_HOURS).toBe(24);
  });

  describe('findOne', () => {
    it('returns an owned gateway enriched with the connected device count', async () => {
      const gateway = gatewayRow({
        cw_gateways_owners: [{ user_id: 'user-123' }],
      });
      const fake = createFakeClient({
        cw_gateways: [{ data: gateway, error: null }],
        cw_device_gateway: [
          {
            data: [
              { dev_eui: 'a', gateway_id: 'gw-001' },
              { dev_eui: 'b', gateway_id: 'gw-001' },
              { dev_eui: 'a', gateway_id: 'gw-001' },
            ],
            error: null,
          },
        ],
      });
      supabaseService.getClient.mockReturnValue(fake.client);

      const result = await service.findOne(' gw-001 ', user);

      expect(result).toMatchObject({
        gateway_id: 'gw-001',
        connected_device_count: 2,
        cw_gateways_owners: [{ user_id: 'user-123' }],
      });
      expect(fake.queriesFor('cw_gateways')[0].calls).toContainEqual({
        method: 'eq',
        args: ['gateway_id', 'gw-001'],
      });
      // Connected count is windowed.
      const dg = fake.queriesFor('cw_device_gateway')[0].calls;
      expect(dg.find((c) => c.method === 'gte')?.args[0]).toBe('last_update');
    });

    it('returns 404 for a private gateway the caller has no relation to', async () => {
      const fake = createFakeClient({
        cw_gateways: [
          {
            data: gatewayRow({ cw_gateways_owners: [{ user_id: 'other' }] }),
            error: null,
          },
        ],
      });
      supabaseService.getClient.mockReturnValue(fake.client);

      await expect(service.findOne('gw-001', user)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('lets org managers view the org gateway', async () => {
      accessService.getManagedOrgIds.mockResolvedValue(['org-1']);
      const fake = createFakeClient({
        cw_gateways: [{ data: gatewayRow({ org_id: 'org-1' }), error: null }],
      });
      supabaseService.getClient.mockReturnValue(fake.client);

      await expect(service.findOne('gw-001', user)).resolves.toMatchObject({
        gateway_id: 'gw-001',
        connected_device_count: 0,
      });
    });

    it('shows public gateways to everyone without exposing their owners', async () => {
      const fake = createFakeClient({
        cw_gateways: [
          {
            data: gatewayRow({
              is_public: true,
              cw_gateways_owners: [{ user_id: 'other-owner' }],
            }),
            error: null,
          },
        ],
      });
      supabaseService.getClient.mockReturnValue(fake.client);

      const result = await service.findOne('gw-001', user);

      expect(result).toMatchObject({ gateway_id: 'gw-001', is_public: true });
      expect(result).not.toHaveProperty('cw_gateways_owners');
    });
  });

  describe('findAll', () => {
    it('merges owned and public gateways, batching enrichment queries', async () => {
      const owned = [
        gatewayRow({ cw_gateways_owners: [{ user_id: 'user-123' }] }),
        gatewayRow({
          id: 12,
          gateway_id: 'gw-002',
          cw_gateways_owners: [{ user_id: 'user-123' }],
        }),
      ];
      const publicRows = [
        gatewayRow({ is_public: true, cw_gateways_owners: undefined }),
        gatewayRow({
          id: 13,
          gateway_id: 'gw-003',
          is_public: true,
          cw_gateways_owners: undefined,
        }),
      ];
      const fake = createFakeClient({
        cw_gateways: [
          { data: owned, error: null },
          { data: publicRows, error: null },
        ],
        cw_device_gateway: [
          {
            data: [{ dev_eui: 'a', gateway_id: 'gw-003' }],
            error: null,
          },
        ],
      });
      supabaseService.getClient.mockReturnValue(fake.client);

      const result = await service.findAll(user);

      expect(result.map((g) => g.gateway_id)).toEqual([
        'gw-001',
        'gw-002',
        'gw-003',
      ]);
      expect(result[2].connected_device_count).toBe(1);
      expect(result[0]).not.toHaveProperty('cw_gateways_owners');

      const [ownedQuery, publicQuery] = fake.queriesFor('cw_gateways');
      expect(ownedQuery.calls).toContainEqual({
        method: 'select',
        args: ['*, cw_gateways_owners!inner(*)'],
      });
      expect(ownedQuery.calls).toContainEqual({
        method: 'eq',
        args: ['cw_gateways_owners.user_id', 'user-123'],
      });
      expect(publicQuery.calls).toContainEqual({
        method: 'eq',
        args: ['is_public', true],
      });
      // One sightings query for all three gateways.
      expect(fake.queriesFor('cw_device_gateway')).toHaveLength(1);
      expect(fake.queriesFor('cw_device_gateway')[0].calls).toContainEqual({
        method: 'in',
        args: ['gateway_id', ['gw-001', 'gw-002', 'gw-003']],
      });
    });
  });

  describe('findByDevice', () => {
    it('anonymizes gateways the caller cannot view or that are unregistered', async () => {
      accessService.assertDeviceAccess.mockResolvedValue({ devEui: 'dev-1' });
      const fake = createFakeClient({
        cw_device_gateway: [
          {
            data: [
              {
                dev_eui: 'dev-1',
                gateway_id: 'gw-mine',
                rssi: -80,
                snr: 7,
                last_update: '2026-10-05T10:00:00.000Z',
              },
              {
                dev_eui: 'dev-1',
                gateway_id: 'gw-private',
                rssi: -100,
                snr: 1,
                last_update: '2026-10-05T11:00:00.000Z',
              },
              {
                dev_eui: 'dev-1',
                gateway_id: 'gw-foreign',
                rssi: -110,
                snr: -3,
                last_update: '2026-10-05T09:00:00.000Z',
              },
            ],
            error: null,
          },
        ],
        cw_gateways: [
          {
            data: [
              gatewayRow({
                gateway_id: 'gw-mine',
                gateway_name: 'Mine',
                cw_gateways_owners: [{ user_id: 'user-123' }],
              }),
              gatewayRow({
                id: 99,
                gateway_id: 'gw-private',
                gateway_name: 'Secret',
                cw_gateways_owners: [{ user_id: 'other' }],
              }),
            ],
            error: null,
          },
        ],
      });
      supabaseService.getClient.mockReturnValue(fake.client);

      const result = await service.findByDevice('dev-1', user);

      expect(accessService.assertDeviceAccess).toHaveBeenCalledWith(
        user,
        'dev-1',
        Action.DeviceRead,
      );
      expect(result).toEqual([
        {
          anonymized: true,
          gateway_id: null,
          gateway_name: null,
          is_online: null,
          rssi: -100,
          snr: 1,
          last_update: '2026-10-05T11:00:00.000Z',
        },
        {
          anonymized: false,
          gateway_id: 'gw-mine',
          gateway_name: 'Mine',
          is_online: true,
          rssi: -80,
          snr: 7,
          last_update: '2026-10-05T10:00:00.000Z',
        },
        {
          anonymized: true,
          gateway_id: null,
          gateway_name: null,
          is_online: null,
          rssi: -110,
          snr: -3,
          last_update: '2026-10-05T09:00:00.000Z',
        },
      ]);
    });

    it('propagates device access denial', async () => {
      accessService.assertDeviceAccess.mockRejectedValue(
        new NotFoundException('Device not found'),
      );
      await expect(service.findByDevice('dev-x', user)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('findDevices', () => {
    it('lists readable devices and counts the rest', async () => {
      const fake = createFakeClient({
        cw_gateways: [
          {
            data: gatewayRow({ cw_gateways_owners: [{ user_id: 'user-123' }] }),
            error: null,
          },
        ],
        cw_device_gateway: [
          {
            data: [
              {
                dev_eui: 'mine-1',
                gateway_id: 'gw-001',
                rssi: -70,
                snr: 9,
                last_update: '2026-10-05T08:00:00.000Z',
              },
              {
                dev_eui: 'mine-2',
                gateway_id: 'gw-001',
                rssi: -75,
                snr: 8,
                last_update: '2026-10-05T09:00:00.000Z',
              },
              {
                dev_eui: 'theirs',
                gateway_id: 'gw-001',
                rssi: -90,
                snr: 2,
                last_update: '2026-10-05T10:00:00.000Z',
              },
            ],
            error: null,
          },
        ],
        cw_devices: [
          {
            data: [
              {
                dev_eui: 'mine-1',
                location_id: 3,
                cw_locations: { name: 'Greenhouse' },
              },
              { dev_eui: 'mine-2', location_id: null, cw_locations: null },
            ],
            error: null,
          },
        ],
      });
      supabaseService.getClient.mockReturnValue(fake.client);
      accessService.listAccessibleDevices.mockResolvedValue([
        { devEui: 'mine-1', name: 'Sensor 1', canView: true },
        { devEui: 'mine-2', name: null, canView: true },
        { devEui: 'theirs', name: 'Hidden', canView: false },
      ]);

      const result = await service.findDevices('gw-001', user);

      expect(result.other_device_count).toBe(1);
      expect(result.devices).toEqual([
        {
          dev_eui: 'mine-2',
          name: null,
          location_id: null,
          location_name: null,
          rssi: -75,
          snr: 8,
          last_update: '2026-10-05T09:00:00.000Z',
        },
        {
          dev_eui: 'mine-1',
          name: 'Sensor 1',
          location_id: 3,
          location_name: 'Greenhouse',
          rssi: -70,
          snr: 9,
          last_update: '2026-10-05T08:00:00.000Z',
        },
      ]);
      const dg = fake.queriesFor('cw_device_gateway')[0].calls;
      expect(dg).toContainEqual({
        method: 'eq',
        args: ['gateway_id', 'gw-001'],
      });
      expect(dg.some((c) => c.method === 'gte')).toBe(true);
    });

    it('returns 404 for an invisible gateway', async () => {
      const fake = createFakeClient({
        cw_gateways: [{ data: gatewayRow(), error: null }],
      });
      supabaseService.getClient.mockReturnValue(fake.client);

      await expect(service.findDevices('gw-001', user)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(accessService.listAccessibleDevices).not.toHaveBeenCalled();
    });
  });
});
