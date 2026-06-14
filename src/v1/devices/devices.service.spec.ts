import { Test, TestingModule } from '@nestjs/testing';
import { DevicesService } from './devices.service';
import { SupabaseService } from '../../supabase/supabase.service';
import { LocationsService } from '../locations/locations.service';

describe('DevicesService', () => {
  let service: DevicesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DevicesService,
        {
          provide: SupabaseService,
          useValue: {
            getClient: () => null,
            getAdminClient: () => null,
          },
        },
        {
          provide: LocationsService,
          useValue: {},
        },
      ],
    }).compile();

    service = module.get<DevicesService>(DevicesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('returns latest primary rows for devices with data and skips devices without readings', async () => {
    const createBuilder = (response: {
      data: unknown;
      count?: number | null;
      error: unknown;
    }) => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      lt: jest.fn().mockReturnThis(),
      or: jest.fn().mockReturnThis(),
      ilike: jest.fn().mockReturnThis(),
      not: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      range: jest.fn().mockResolvedValue(response),
      limit: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue(response),
      single: jest.fn().mockResolvedValue(response),
    });

    const devicesBuilder = createBuilder({
      data: [
        {
          dev_eui: 'dev-1',
          name: 'North sensor',
          group: 'air',
          location_id: 42,
          last_data_updated_at: '2026-03-13T00:00:00.000Z',
          cw_device_type: {
            name: 'Air',
            primary_data_v2: 'temperature_c',
            secondary_data_v2: 'co2',
            data_table_v2: 'cw_air_data',
          },
          cw_locations: [
            { location_id: 42, name: 'North Room', group: 'Farm A' },
          ],
        },
        {
          dev_eui: 'dev-2',
          name: 'South sensor',
          group: 'air',
          location_id: 77,
          cw_device_type: {
            name: 'Air',
            primary_data_v2: 'temperature_c',
            secondary_data_v2: 'co2',
            data_table_v2: 'cw_air_data',
          },
          cw_locations: [
            { location_id: 77, name: 'South Room', group: 'Farm B' },
          ],
        },
      ],
      count: 2,
      error: null,
    });

    const latestDataBuilders = [
      createBuilder({
        data: {
          created_at: '2026-03-13T00:00:00.000Z',
          temperature_c: 24.2,
          co2: 810,
          humidity: 55,
        },
        error: null,
      }),
      createBuilder({
        data: null,
        error: null,
      }),
    ];

    const client = {
      from: jest.fn((table: string) => {
        if (table === 'cw_devices') return devicesBuilder;
        if (table === 'cw_air_data') {
          const builder = latestDataBuilders.shift();
          if (!builder) {
            throw new Error(
              `Unexpected extra latest-data query for table ${table}`,
            );
          }
          return builder;
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    };

    const supabaseService = {
      getClient: jest.fn(() => client),
      getAdminClient: jest.fn(),
    };

    const latestDataService = new DevicesService(
      supabaseService as unknown as SupabaseService,
      {} as any,
    );

    const result = await latestDataService.findAllLatestData(
      { sub: 'user-1' },
      0,
      25,
      'Bearer test-token',
    );

    expect(result.total).toBe(2);
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({
      dev_eui: 'dev-1',
      name: 'North sensor',
      location_name: 'North Room',
      location_id: 42,
      group: 'air',
      created_at: '2026-03-13T00:00:00.000Z',
      temperature_c: 24.2,
      co2: 810,
      humidity: 55,
    });
  });

  it('findOne should allow cropwatch staff to bypass device ownership filters', async () => {
    const deviceBuilder = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      lt: jest.fn().mockReturnThis(),
      lte: jest.fn().mockReturnThis(),
      or: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: { dev_eui: 'DEV-001', name: 'Global Device' },
        error: null,
      }),
    };

    const client = {
      from: jest.fn((table: string) => {
        if (table === 'cw_devices') {
          return deviceBuilder;
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    };

    const supabaseService = {
      getClient: jest.fn(() => client),
      getAdminClient: jest.fn(),
    };

    const deviceService = new DevicesService(
      supabaseService as unknown as SupabaseService,
      {} as any,
    );

    await expect(
      deviceService.findOne(
        { sub: 'staff-1', email: 'staff@cropwatch.io' },
        'DEV-001',
        'Bearer test-token',
      ),
    ).resolves.toMatchObject({ dev_eui: 'DEV-001', name: 'Global Device' });

    expect(deviceBuilder.eq).toHaveBeenCalledWith('dev_eui', 'DEV-001');
    expect(deviceBuilder.eq).not.toHaveBeenCalledWith(
      'owner_match.user_id',
      'staff-1',
    );
  });

  describe('updateDevice location moves', () => {
    const jwt = { sub: 'mover-1', email: 'mover@example.com' };

    function createPermissionCheckBuilder(deviceRow: unknown) {
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        lte: jest.fn().mockReturnThis(),
        or: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: deviceRow, error: null }),
      };
    }

    function createDestinationBuilder(locationRow: unknown) {
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        lte: jest.fn().mockReturnThis(),
        or: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({ data: locationRow, error: null }),
      };
    }

    function createUpdateBuilder() {
      return {
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        select: jest.fn().mockResolvedValue({ data: [{ dev_eui: 'DEV-001' }], error: null }),
      };
    }

    function createDeleteBuilder() {
      return {
        delete: jest.fn().mockReturnThis(),
        eq: jest.fn().mockResolvedValue({ error: null }),
      };
    }

    function createInsertBuilder() {
      return {
        insert: jest.fn().mockResolvedValue({ error: null }),
      };
    }

    function createService(builders: unknown[]) {
      const fromMock = jest.fn();
      for (const builder of builders) {
        fromMock.mockImplementationOnce(() => builder);
      }
      const supabaseService = {
        getClient: jest.fn(() => ({ from: fromMock })),
        getAdminClient: jest.fn(),
      };
      return {
        service: new DevicesService(supabaseService as unknown as SupabaseService, {} as any),
        fromMock,
      };
    }

    it('hands the device to the destination owner and resets permissions on a move', async () => {
      const permissionBuilder = createPermissionCheckBuilder({
        dev_eui: 'DEV-001',
        location_id: 1,
        user_id: 'old-owner',
      });
      const destinationBuilder = createDestinationBuilder({
        location_id: 2,
        owner_id: 'new-owner',
        cw_location_owners: [
          { user_id: 'new-owner' },
          { user_id: 'mover-1' },
          { user_id: 'member-a' },
          { user_id: 'member-b' },
        ],
      });
      const updateBuilder = createUpdateBuilder();
      const deleteBuilder = createDeleteBuilder();
      const insertBuilder = createInsertBuilder();
      const { service, fromMock } = createService([
        permissionBuilder,
        destinationBuilder,
        updateBuilder,
        deleteBuilder,
        insertBuilder,
      ]);

      await service.updateDevice(jwt, 'DEV-001', 'Sensor', null, 2, 'Bearer token-1');

      // Mover needed manage scope on the destination location.
      expect(destinationBuilder.eq).toHaveBeenCalledWith('location_id', 2);
      expect(destinationBuilder.lte).toHaveBeenCalledWith('owner_match.permission_level', 2);

      // Device ownership follows the destination location owner.
      expect(updateBuilder.update).toHaveBeenCalledWith({
        name: 'Sensor',
        group: null,
        location_id: 2,
        user_id: 'new-owner',
      });

      // Old permissions wiped...
      expect(deleteBuilder.eq).toHaveBeenCalledWith('dev_eui', 'DEV-001');

      // ...mover becomes Admin, other members Disabled, owner gets no row.
      const insertedRows = insertBuilder.insert.mock.calls[0][0];
      expect(insertedRows).toEqual(
        expect.arrayContaining([
          { dev_eui: 'DEV-001', user_id: 'mover-1', permission_level: 1 },
          { dev_eui: 'DEV-001', user_id: 'member-a', permission_level: 5 },
          { dev_eui: 'DEV-001', user_id: 'member-b', permission_level: 5 },
        ]),
      );
      expect(insertedRows).toHaveLength(3);
      expect(fromMock).toHaveBeenCalledTimes(5);
    });

    it('rejects a move when the mover cannot manage the destination location', async () => {
      const permissionBuilder = createPermissionCheckBuilder({
        dev_eui: 'DEV-001',
        location_id: 1,
        user_id: 'old-owner',
      });
      const destinationBuilder = createDestinationBuilder(null);
      const { service, fromMock } = createService([permissionBuilder, destinationBuilder]);

      await expect(
        service.updateDevice(jwt, 'DEV-001', 'Sensor', null, 2, 'Bearer token-1'),
      ).rejects.toMatchObject({
        message: 'You do not have permission to move this device to that location',
      });

      // The device update must never run.
      expect(fromMock).toHaveBeenCalledTimes(2);
    });

    it('leaves ownership and permissions untouched when the location does not change', async () => {
      const permissionBuilder = createPermissionCheckBuilder({
        dev_eui: 'DEV-001',
        location_id: 2,
        user_id: 'old-owner',
      });
      const updateBuilder = createUpdateBuilder();
      const { service, fromMock } = createService([permissionBuilder, updateBuilder]);

      await service.updateDevice(jwt, 'DEV-001', 'Renamed', 'greenhouse', 2, 'Bearer token-1');

      expect(updateBuilder.update).toHaveBeenCalledWith({
        name: 'Renamed',
        group: 'greenhouse',
        location_id: 2,
      });
      // No destination lookup, no permission reset.
      expect(fromMock).toHaveBeenCalledTimes(2);
    });

    it('keeps the current device owner when the destination location has no owner', async () => {
      const permissionBuilder = createPermissionCheckBuilder({
        dev_eui: 'DEV-001',
        location_id: 1,
        user_id: 'old-owner',
      });
      const destinationBuilder = createDestinationBuilder({
        location_id: 2,
        owner_id: null,
        cw_location_owners: [{ user_id: 'member-a' }],
      });
      const updateBuilder = createUpdateBuilder();
      const deleteBuilder = createDeleteBuilder();
      const insertBuilder = createInsertBuilder();
      const { service } = createService([
        permissionBuilder,
        destinationBuilder,
        updateBuilder,
        deleteBuilder,
        insertBuilder,
      ]);

      await service.updateDevice(jwt, 'DEV-001', 'Sensor', null, 2, 'Bearer token-1');

      expect(updateBuilder.update).toHaveBeenCalledWith({
        name: 'Sensor',
        group: null,
        location_id: 2,
      });
      const insertedRows = insertBuilder.insert.mock.calls[0][0];
      expect(insertedRows).toEqual(
        expect.arrayContaining([
          { dev_eui: 'DEV-001', user_id: 'mover-1', permission_level: 1 },
          { dev_eui: 'DEV-001', user_id: 'member-a', permission_level: 5 },
        ]),
      );
    });
  });
});
