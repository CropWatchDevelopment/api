import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DevicesService } from './devices.service';
import { SupabaseService } from '../../supabase/supabase.service';
import { LocationsService } from '../locations/locations.service';
import { PaymentsService } from '../payments/payments.service';
import { AccessService, Action, type DeviceAccess } from '../common/authz';

describe('DevicesService', () => {
  let service: DevicesService;

  const deviceAccess = (
    overrides: Partial<DeviceAccess> = {},
  ): DeviceAccess => ({
    exists: true,
    devEui: 'DEV-001',
    orgId: null,
    orgRole: null,
    parentRead: false,
    locationId: 1,
    ownerId: 'old-owner',
    isStaff: false,
    isOwner: false,
    level: 1,
    canRead: true,
    ...overrides,
  });

  const createAccessMock = () =>
    ({
      assertDeviceAccess: jest.fn(),
      assertLocationAccess: jest.fn(),
      getDeviceAccess: jest.fn(),
      getLocationAccess: jest.fn(),
      getReadableOrgIds: jest.fn().mockResolvedValue([]),
      getManagedOrgIds: jest.fn().mockResolvedValue([]),
    }) as unknown as AccessService & {
      assertDeviceAccess: jest.Mock;
      assertLocationAccess: jest.Mock;
      getDeviceAccess: jest.Mock;
      getLocationAccess: jest.Mock;
    };

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
        {
          provide: PaymentsService,
          useValue: {
            assertLicenseAvailable: jest.fn(),
            assignLicense: jest.fn(),
          },
        },
        {
          provide: AccessService,
          useValue: {
            getReadableOrgIds: jest.fn().mockResolvedValue([]),
            getManagedOrgIds: jest.fn().mockResolvedValue([]),
          },
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
      {} as LocationsService,
      {} as PaymentsService,
      createAccessMock(),
    );

    const result = await latestDataService.findAllLatestData(
      { sub: 'user-1', email: null, isStaff: false },
      0,
      25,
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

    const accessService = createAccessMock();
    accessService.getDeviceAccess.mockResolvedValue(
      deviceAccess({ isStaff: true, level: null }),
    );
    const deviceService = new DevicesService(
      supabaseService as unknown as SupabaseService,
      {} as LocationsService,
      {} as PaymentsService,
      accessService,
    );

    await expect(
      deviceService.findOne(
        { sub: 'staff-1', email: 'staff@cropwatch.io', isStaff: true },
        'DEV-001',
      ),
    ).resolves.toMatchObject({
      dev_eui: 'DEV-001',
      name: 'Global Device',
      can_write_notes: true,
    });

    // Staff skip every scope filter: only the primary-key eq is applied.
    expect(deviceBuilder.eq).toHaveBeenCalledTimes(1);
    expect(deviceBuilder.eq).toHaveBeenCalledWith('dev_eui', 'DEV-001');
    expect(deviceBuilder.or).not.toHaveBeenCalled();
  });

  describe('findOne can_write_notes', () => {
    function findOneAs(access: DeviceAccess) {
      const deviceBuilder: Record<string, jest.Mock> = {};
      for (const method of ['select', 'eq', 'lt', 'or', 'order']) {
        deviceBuilder[method] = jest.fn(() => deviceBuilder);
      }
      deviceBuilder.single = jest.fn().mockResolvedValue({
        data: { dev_eui: 'DEV-001', name: 'Greenhouse' },
        error: null,
      });
      const accessService = createAccessMock();
      accessService.getDeviceAccess.mockResolvedValue(access);
      const deviceService = new DevicesService(
        {
          getClient: () => ({ from: () => deviceBuilder }),
          getAdminClient: jest.fn(),
        } as unknown as SupabaseService,
        {} as LocationsService,
        {} as PaymentsService,
        accessService,
      );
      return deviceService
        .findOne(
          { sub: 'user-1', email: 'user@example.com', isStaff: false },
          'DEV-001',
        )
        .then((device) => device.can_write_notes);
    }

    it.each([
      ['an Admin', deviceAccess({ level: 1 }), true],
      ['a Manager', deviceAccess({ level: 2 }), true],
      ['a User', deviceAccess({ level: 3 }), true],
      ['the owner', deviceAccess({ level: null, isOwner: true }), true],
      [
        'an org manager',
        deviceAccess({ level: null, orgRole: 'manager' }),
        true,
      ],
      ['a Viewer', deviceAccess({ level: 4 }), false],
      [
        'a parent org reader',
        deviceAccess({ level: null, parentRead: true }),
        false,
      ],
    ])('is %s → %s', async (_who, access, expected) => {
      await expect(findOneAs(access)).resolves.toBe(expected);
    });
  });

  describe('updateDevice location moves', () => {
    const jwt = { sub: 'mover-1', email: 'mover@example.com', isStaff: false };

    function createDestinationBuilder(locationRow: unknown) {
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        lte: jest.fn().mockReturnThis(),
        or: jest.fn().mockReturnThis(),
        maybeSingle: jest
          .fn()
          .mockResolvedValue({ data: locationRow, error: null }),
      };
    }

    function createUpdateBuilder() {
      return {
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        select: jest
          .fn()
          .mockResolvedValue({ data: [{ dev_eui: 'DEV-001' }], error: null }),
      };
    }

    function createDeleteBuilder() {
      return {
        delete: jest.fn().mockReturnThis(),
        eq: jest.fn().mockResolvedValue({ error: null }),
      };
    }

    type DeviceOwnerInsert = {
      dev_eui: string;
      user_id: string;
      permission_level: number;
    };

    function createInsertBuilder() {
      return {
        insert: jest
          .fn<Promise<{ error: null }>, [rows: DeviceOwnerInsert[]]>()
          .mockResolvedValue({ error: null }),
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
      const accessService = createAccessMock();
      return {
        service: new DevicesService(
          supabaseService as unknown as SupabaseService,
          {} as LocationsService,
          {} as PaymentsService,
          accessService,
        ),
        fromMock,
        accessService,
      };
    }

    it('hands the device to the destination owner and resets permissions on a move', async () => {
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
      const { service, fromMock, accessService } = createService([
        destinationBuilder,
        updateBuilder,
        deleteBuilder,
        insertBuilder,
      ]);
      accessService.assertDeviceAccess.mockResolvedValue(
        deviceAccess({ locationId: 1 }),
      );

      await service.updateDevice(jwt, 'DEV-001', 'Sensor', null, 2);

      // Editing needed Manager tier on the device itself.
      expect(accessService.assertDeviceAccess).toHaveBeenCalledWith(
        jwt,
        'DEV-001',
        Action.DeviceEdit,
      );

      // Mover needed manage scope on the destination location.
      expect(destinationBuilder.eq).toHaveBeenCalledWith('location_id', 2);
      expect(destinationBuilder.lte).toHaveBeenCalledTimes(1);
      expect(destinationBuilder.or).toHaveBeenCalledTimes(1);

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
      expect(fromMock).toHaveBeenCalledTimes(4);
    });

    it('rejects a move when the mover cannot manage the destination location', async () => {
      const destinationBuilder = createDestinationBuilder(null);
      const { service, fromMock, accessService } = createService([
        destinationBuilder,
      ]);
      accessService.assertDeviceAccess.mockResolvedValue(
        deviceAccess({ locationId: 1 }),
      );

      await expect(
        service.updateDevice(jwt, 'DEV-001', 'Sensor', null, 2),
      ).rejects.toMatchObject({
        status: 403,
        message:
          'You do not have permission to move this device to that location',
      });

      // The device update must never run.
      expect(fromMock).toHaveBeenCalledTimes(1);
    });

    it('leaves ownership and permissions untouched when the location does not change', async () => {
      const updateBuilder = createUpdateBuilder();
      const { service, fromMock, accessService } = createService([
        updateBuilder,
      ]);
      accessService.assertDeviceAccess.mockResolvedValue(
        deviceAccess({ locationId: 2 }),
      );

      await service.updateDevice(jwt, 'DEV-001', 'Renamed', 'greenhouse', 2);

      expect(updateBuilder.update).toHaveBeenCalledWith({
        name: 'Renamed',
        group: 'greenhouse',
        location_id: 2,
      });
      // No destination lookup, no permission reset.
      expect(fromMock).toHaveBeenCalledTimes(1);
    });

    it('keeps the current device owner when the destination location has no owner', async () => {
      const destinationBuilder = createDestinationBuilder({
        location_id: 2,
        owner_id: null,
        cw_location_owners: [{ user_id: 'member-a' }],
      });
      const updateBuilder = createUpdateBuilder();
      const deleteBuilder = createDeleteBuilder();
      const insertBuilder = createInsertBuilder();
      const { service, accessService } = createService([
        destinationBuilder,
        updateBuilder,
        deleteBuilder,
        insertBuilder,
      ]);
      accessService.assertDeviceAccess.mockResolvedValue(
        deviceAccess({ locationId: 1 }),
      );

      await service.updateDevice(jwt, 'DEV-001', 'Sensor', null, 2);

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

  describe('createDevice license gate', () => {
    const DEV_EUI = 'AAAA000000000001';
    const staffUser = {
      sub: 'staff-1',
      email: 'staff@cropwatch.io',
      isStaff: true,
    };
    const customer = {
      sub: 'user-1',
      email: 'customer@example.com',
      isStaff: false,
    };

    const buildClient = () => {
      const devicesBuilder = {
        insert: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest
          .fn()
          .mockResolvedValue({ data: { dev_eui: DEV_EUI }, error: null }),
      };
      const ownersBuilder = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockResolvedValue({ data: [], error: null }),
      };
      const inventoryBuilder = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
      };
      const client = {
        from: jest.fn((table: string) =>
          table === 'cw_devices'
            ? devicesBuilder
            : table === 'cw_device_inventory'
              ? inventoryBuilder
              : ownersBuilder,
        ),
      };
      return { client, devicesBuilder };
    };

    const buildService = async (
      payments: {
        assertLicenseAvailable: jest.Mock;
        assignLicense: jest.Mock;
      },
      client: unknown,
    ) => {
      const accessService = {
        // Location Admins/Managers and the owner may add devices.
        assertLocationAccess: jest.fn().mockResolvedValue({
          exists: true,
          locationId: 2,
          ownerId: 'user-1',
          isStaff: false,
          isOwner: true,
          level: 1,
          canRead: true,
        }),
      };
      const module = await Test.createTestingModule({
        providers: [
          DevicesService,
          {
            provide: SupabaseService,
            useValue: {
              getClient: () => client,
              getAdminClient: () => client,
            },
          },
          {
            provide: LocationsService,
            useValue: {},
          },
          { provide: PaymentsService, useValue: payments },
          { provide: AccessService, useValue: accessService },
        ],
      }).compile();
      return {
        service: module.get<DevicesService>(DevicesService),
        accessService,
      };
    };

    it('rejects a non-staff create without license_id before touching the database', async () => {
      const payments = {
        assertLicenseAvailable: jest.fn(),
        assignLicense: jest.fn(),
      };
      const { client, devicesBuilder } = buildClient();
      const { service: deviceService } = await buildService(payments, client);

      await expect(
        deviceService.createDevice(customer, DEV_EUI, {
          dev_eui: DEV_EUI,
          location_id: 2,
        }),
      ).rejects.toMatchObject({ status: 403 });
      expect(devicesBuilder.insert).not.toHaveBeenCalled();
      expect(payments.assignLicense).not.toHaveBeenCalled();
    });

    it('gates creation on location-manage access, not literal ownership', async () => {
      const payments = {
        assertLicenseAvailable: jest.fn().mockResolvedValue(undefined),
        assignLicense: jest.fn().mockResolvedValue({}),
      };
      const { client } = buildClient();
      const { service: deviceService, accessService } = await buildService(
        payments,
        client,
      );

      await deviceService.createDevice(customer, DEV_EUI, {
        dev_eui: DEV_EUI,
        location_id: 2,
        license_id: 6,
      });

      expect(accessService.assertLocationAccess).toHaveBeenCalledWith(
        customer,
        2,
        Action.LocationDeviceCreate,
      );
    });

    it('validates the seat before insert and consumes it after creation', async () => {
      const payments = {
        assertLicenseAvailable: jest.fn().mockResolvedValue(undefined),
        assignLicense: jest.fn().mockResolvedValue({}),
      };
      const { client, devicesBuilder } = buildClient();
      const { service: deviceService } = await buildService(payments, client);

      await deviceService.createDevice(customer, DEV_EUI, {
        dev_eui: DEV_EUI,
        location_id: 2,
        license_id: 6,
      });

      expect(payments.assertLicenseAvailable).toHaveBeenCalledWith(customer, 6);
      expect(devicesBuilder.insert).toHaveBeenCalled();
      expect(payments.assignLicense).toHaveBeenCalledWith(customer, 6, DEV_EUI);
    });

    it('does not create the device when the seat is unavailable', async () => {
      const payments = {
        assertLicenseAvailable: jest
          .fn()
          .mockRejectedValue(new Error('License is already assigned')),
        assignLicense: jest.fn(),
      };
      const { client, devicesBuilder } = buildClient();
      const { service: deviceService } = await buildService(payments, client);

      await expect(
        deviceService.createDevice(customer, DEV_EUI, {
          dev_eui: DEV_EUI,
          location_id: 2,
          license_id: 6,
        }),
      ).rejects.toThrow('License is already assigned');
      expect(devicesBuilder.insert).not.toHaveBeenCalled();
      expect(payments.assignLicense).not.toHaveBeenCalled();
    });

    it('exempts staff from the license requirement but consumes a supplied seat', async () => {
      const payments = {
        assertLicenseAvailable: jest.fn().mockResolvedValue(undefined),
        assignLicense: jest.fn().mockResolvedValue({}),
      };
      const { client } = buildClient();
      const { service: deviceService } = await buildService(payments, client);

      await deviceService.createDevice(staffUser, DEV_EUI, {
        dev_eui: DEV_EUI,
        location_id: 2,
      });
      expect(payments.assertLicenseAvailable).not.toHaveBeenCalled();
      expect(payments.assignLicense).not.toHaveBeenCalled();

      await deviceService.createDevice(staffUser, DEV_EUI, {
        dev_eui: DEV_EUI,
        location_id: 2,
        license_id: 7,
      });
      expect(payments.assertLicenseAvailable).toHaveBeenCalledWith(
        staffUser,
        7,
      );
      expect(payments.assignLicense).toHaveBeenCalledWith(
        staffUser,
        7,
        DEV_EUI,
      );
    });
  });

  describe('createDevice errors', () => {
    const DEV_EUI = '00137A10000441E0';
    const customer = {
      sub: 'user-1',
      email: 'customer@example.com',
      isStaff: false,
    };

    const buildService = async (
      insertError: { code: string; message: string } | null,
      assignLicense: jest.Mock,
      reservation: { org_id: string | null } | null = null,
    ) => {
      const deleteEq = jest.fn().mockResolvedValue({ error: null });
      const devicesBuilder = {
        insert: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest
          .fn()
          .mockResolvedValue(
            insertError
              ? { data: null, error: insertError }
              : { data: { dev_eui: DEV_EUI }, error: null },
          ),
        delete: jest.fn(() => ({ eq: deleteEq })),
      };
      const inventoryBuilder = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest
          .fn()
          .mockResolvedValue({ data: reservation, error: null }),
      };
      const client = {
        from: jest.fn((table: string) =>
          table === 'cw_device_inventory' ? inventoryBuilder : devicesBuilder,
        ),
      };
      const module = await Test.createTestingModule({
        providers: [
          DevicesService,
          {
            provide: SupabaseService,
            useValue: { getClient: () => client, getAdminClient: () => client },
          },
          { provide: LocationsService, useValue: {} },
          {
            provide: PaymentsService,
            useValue: {
              assertLicenseAvailable: jest.fn().mockResolvedValue(undefined),
              assignLicense,
            },
          },
          {
            provide: AccessService,
            useValue: {
              assertLocationAccess: jest
                .fn()
                .mockResolvedValue({ orgId: 'org-1' }),
            },
          },
        ],
      }).compile();
      return {
        service: module.get<DevicesService>(DevicesService),
        devicesBuilder,
        deleteEq,
      };
    };

    const create = (service: DevicesService) =>
      service.createDevice(customer, DEV_EUI, {
        dev_eui: DEV_EUI,
        location_id: 8,
        license_id: 1,
      });

    it('returns 409 naming the DevEUI when it is already registered', async () => {
      const assignLicense = jest.fn();
      const { service } = await buildService(
        { code: '23505', message: 'duplicate key value' },
        assignLicense,
      );

      await expect(create(service)).rejects.toMatchObject({
        status: 409,
        message: `A device with DevEUI ${DEV_EUI} is already registered.`,
      });
      expect(assignLicense).not.toHaveBeenCalled();
    });

    it('returns 400 when the device type or location does not exist', async () => {
      const { service } = await buildService(
        { code: '23503', message: 'violates foreign key constraint' },
        jest.fn(),
      );

      await expect(create(service)).rejects.toMatchObject({ status: 400 });
    });

    it('removes the new device when the license cannot be assigned', async () => {
      const failure = new Error('License is already assigned');
      const { service, devicesBuilder, deleteEq } = await buildService(
        null,
        jest.fn().mockRejectedValue(failure),
      );

      await expect(create(service)).rejects.toBe(failure);
      expect(devicesBuilder.delete).toHaveBeenCalled();
      expect(deleteEq).toHaveBeenCalledWith('dev_eui', DEV_EUI);
    });

    it('stores the DevEUI in its canonical form', async () => {
      const { service, devicesBuilder } = await buildService(
        null,
        jest.fn().mockResolvedValue({}),
      );
      await service.createDevice(customer, '00:13:7a:10:00:04:41:e0', {
        dev_eui: '00:13:7a:10:00:04:41:e0',
        location_id: 8,
        license_id: 1,
      });
      expect(devicesBuilder.insert).toHaveBeenCalledWith(
        expect.objectContaining({ dev_eui: DEV_EUI }),
      );
    });

    it('rejects a DevEUI that is not 16 hexadecimal characters', async () => {
      const { service, devicesBuilder } = await buildService(null, jest.fn());
      await expect(
        service.createDevice(customer, '00137A10000441', {
          dev_eui: '00137A10000441',
          location_id: 8,
          license_id: 1,
        }),
      ).rejects.toMatchObject({ status: 400 });
      expect(devicesBuilder.insert).not.toHaveBeenCalled();
    });

    it('refuses a device reserved for another organization', async () => {
      const { service, devicesBuilder } = await buildService(null, jest.fn(), {
        org_id: 'org-2',
      });
      await expect(create(service)).rejects.toMatchObject({ status: 409 });
      expect(devicesBuilder.insert).not.toHaveBeenCalled();
    });

    it('allows a device reserved for the location’s organization', async () => {
      const { service, devicesBuilder } = await buildService(
        null,
        jest.fn().mockResolvedValue({}),
        { org_id: 'org-1' },
      );
      await create(service);
      expect(devicesBuilder.insert).toHaveBeenCalled();
    });
  });

  describe('replaceDevice', () => {
    const admin = {
      sub: 'admin-1',
      email: 'admin@example.com',
      isStaff: false,
    };

    // Update path: .update().eq().select('*').single().
    function createUpdateBuilder(row: unknown) {
      return {
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: row, error: null }),
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
      const accessService = createAccessMock();
      return {
        service: new DevicesService(
          supabaseService as unknown as SupabaseService,
          {} as LocationsService,
          {} as PaymentsService,
          accessService,
        ),
        fromMock,
        accessService,
      };
    }

    it('authorizes against the replacement dev_eui, not the old one', async () => {
      const updateBuilder = createUpdateBuilder({ dev_eui: 'NEW-EUI' });
      const { service, fromMock, accessService } = createService([
        updateBuilder,
      ]);
      accessService.assertDeviceAccess.mockResolvedValue(deviceAccess());

      await service.replaceDevice(admin, 'OLD-EUI', { dev_eui: 'NEW-EUI' });

      // Replacing is Admin-tier on BOTH devices. The bug was that the second
      // check re-queried the old eui, so no authz ever ran on the target.
      expect(accessService.assertDeviceAccess).toHaveBeenNthCalledWith(
        1,
        admin,
        'OLD-EUI',
        Action.DeviceReplace,
      );
      expect(accessService.assertDeviceAccess).toHaveBeenNthCalledWith(
        2,
        admin,
        'NEW-EUI',
        Action.DeviceReplace,
      );
      expect(fromMock).toHaveBeenCalledTimes(1);
    });

    it('does not update when the caller lacks access to the replacement device', async () => {
      const updateBuilder = createUpdateBuilder({ dev_eui: 'NEW-EUI' });
      const { service, fromMock, accessService } = createService([
        updateBuilder,
      ]);
      accessService.assertDeviceAccess
        .mockResolvedValueOnce(deviceAccess())
        .mockRejectedValueOnce(new NotFoundException('Device not found'));

      await expect(
        service.replaceDevice(admin, 'OLD-EUI', { dev_eui: 'NEW-EUI' }),
      ).rejects.toMatchObject({ status: 404 });

      // The device update must never run.
      expect(updateBuilder.update).not.toHaveBeenCalled();
      expect(fromMock).not.toHaveBeenCalled();
    });

    it('rejects a blank replacement dev_eui before any replacement lookup', async () => {
      const updateBuilder = createUpdateBuilder({ dev_eui: 'NEW-EUI' });
      const { service, fromMock, accessService } = createService([
        updateBuilder,
      ]);
      accessService.assertDeviceAccess.mockResolvedValue(deviceAccess());

      await expect(
        service.replaceDevice(admin, 'OLD-EUI', { dev_eui: '  ' }),
      ).rejects.toMatchObject({ status: 400 });

      // Only the existing-device check ran; no replacement check, no update.
      expect(accessService.assertDeviceAccess).toHaveBeenCalledTimes(1);
      expect(fromMock).not.toHaveBeenCalled();
    });
  });

  describe('deleteDevice', () => {
    const owner = {
      sub: 'owner-1',
      email: 'owner@example.com',
      isStaff: false,
    };

    function createService(rpcResponses: { data: unknown; error: unknown }[]) {
      const rpcMock = jest.fn();
      for (const response of rpcResponses) {
        rpcMock.mockResolvedValueOnce(response);
      }
      const supabaseService = {
        getClient: jest.fn(() => ({ rpc: rpcMock })),
        getAdminClient: jest.fn(),
      };
      const accessService = createAccessMock();
      return {
        service: new DevicesService(
          supabaseService as unknown as SupabaseService,
          {} as LocationsService,
          {} as PaymentsService,
          accessService,
        ),
        rpcMock,
        accessService,
      };
    }

    it('checks DeviceDelete, purges in batches, then deletes the device', async () => {
      const { service, rpcMock, accessService } = createService([
        { data: 2500, error: null },
        { data: 512, error: null },
        { data: 0, error: null },
        { data: { deleted: { device_licenses_freed: 1 } }, error: null },
      ]);
      accessService.assertDeviceAccess.mockResolvedValue(deviceAccess());

      const result = await service.deleteDevice(owner, ' DEV-001 ');

      expect(accessService.assertDeviceAccess).toHaveBeenCalledWith(
        owner,
        'DEV-001',
        Action.DeviceDelete,
      );
      expect(rpcMock).toHaveBeenCalledTimes(4);
      expect(rpcMock).toHaveBeenNthCalledWith(1, 'purge_device_data_batch', {
        p_dev_eui: 'DEV-001',
        p_batch_size: 2500,
      });
      expect(rpcMock).toHaveBeenLastCalledWith('delete_device', {
        p_dev_eui: 'DEV-001',
      });
      expect(result).toEqual({
        dev_eui: 'DEV-001',
        complete: true,
        purgedRows: 3012,
        deleted: { device_licenses_freed: 1 },
      });
    });

    it('never touches the database when the caller is not allowed to delete', async () => {
      const { service, rpcMock, accessService } = createService([]);
      accessService.assertDeviceAccess.mockRejectedValue(
        new ForbiddenException('nope'),
      );

      await expect(
        service.deleteDevice(owner, 'DEV-001'),
      ).rejects.toMatchObject({ status: 403 });
      expect(rpcMock).not.toHaveBeenCalled();
    });

    it('does not delete the device row when the purge fails', async () => {
      const { service, rpcMock, accessService } = createService([
        {
          data: null,
          error: { message: 'canceling statement due to statement timeout' },
        },
      ]);
      accessService.assertDeviceAccess.mockResolvedValue(deviceAccess());

      await expect(
        service.deleteDevice(owner, 'DEV-001'),
      ).rejects.toMatchObject({ status: 500 });
      expect(rpcMock).toHaveBeenCalledTimes(1);
      expect(rpcMock).not.toHaveBeenCalledWith(
        'delete_device',
        expect.anything(),
      );
    });

    it('maps DEVICE_NOT_FOUND from the RPC to 404', async () => {
      const { service, accessService } = createService([
        { data: 0, error: null },
        { data: null, error: { message: 'DEVICE_NOT_FOUND' } },
      ]);
      accessService.assertDeviceAccess.mockResolvedValue(deviceAccess());

      await expect(
        service.deleteDevice(owner, 'DEV-001'),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('returns complete: false and keeps the device when the time budget runs out', async () => {
      const { service, rpcMock, accessService } = createService([
        { data: 20000, error: null },
      ]);
      accessService.assertDeviceAccess.mockResolvedValue(deviceAccess());
      const now = jest.spyOn(Date, 'now');
      now.mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValue(60_000);

      const result = await service.deleteDevice(owner, 'DEV-001');

      now.mockRestore();
      expect(result).toEqual({
        dev_eui: 'DEV-001',
        complete: false,
        purgedRows: 20000,
      });
      expect(rpcMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('findAllDevicesInLocation gateway signals', () => {
    const staff = {
      sub: 'staff-1',
      email: 'staff@cropwatch.io',
      isStaff: true,
    };

    /** A client whose queries resolve per table; records the .in() filters. */
    function createService(
      responses: Record<string, { data: unknown; error: unknown }>,
    ) {
      const inCalls: { table: string; values: unknown[] }[] = [];
      const from = jest.fn((table: string) => {
        const builder: Record<string, unknown> = {};
        for (const method of ['select', 'eq', 'or', 'lt', 'lte', 'order']) {
          builder[method] = jest.fn(() => builder);
        }
        builder.in = jest.fn((_column: string, values: unknown[]) => {
          inCalls.push({ table, values });
          return builder;
        });
        builder.then = (resolve: (value: unknown) => unknown) =>
          resolve(responses[table]);
        return builder;
      });
      const service = new DevicesService(
        {
          getClient: () => ({ from }),
          getAdminClient: jest.fn(),
        } as unknown as SupabaseService,
        {} as LocationsService,
        {} as PaymentsService,
        createAccessMock(),
      );
      return { service, inCalls };
    }

    it('attaches every gateway reading to its device, [] when never heard', async () => {
      const { service, inCalls } = createService({
        cw_devices: {
          data: [
            { dev_eui: 'DEV-A', name: 'A' },
            { dev_eui: 'DEV-B', name: 'B' },
          ],
          error: null,
        },
        cw_device_gateway: {
          data: [
            {
              dev_eui: 'DEV-A',
              rssi: -97,
              snr: 6.5,
              last_update: '2026-10-15T14:00:00Z',
            },
            {
              dev_eui: 'DEV-A',
              rssi: -118,
              snr: -9,
              last_update: '2026-10-14T02:00:00Z',
            },
          ],
          error: null,
        },
      });

      const devices = await service.findAllDevicesInLocation(staff, 7);

      expect(inCalls).toEqual([
        { table: 'cw_device_gateway', values: ['DEV-A', 'DEV-B'] },
      ]);
      expect(devices.map((d) => [d.dev_eui, d.gateway_signals])).toEqual([
        [
          'DEV-A',
          [
            { rssi: -97, snr: 6.5, last_update: '2026-10-15T14:00:00Z' },
            { rssi: -118, snr: -9, last_update: '2026-10-14T02:00:00Z' },
          ],
        ],
        ['DEV-B', []],
      ]);
    });

    it('fails rather than return devices without their signals', async () => {
      const { service } = createService({
        cw_devices: { data: [{ dev_eui: 'DEV-A', name: 'A' }], error: null },
        cw_device_gateway: { data: null, error: { message: 'boom' } },
      });

      await expect(
        service.findAllDevicesInLocation(staff, 7),
      ).rejects.toMatchObject({ status: 500 });
    });
  });

  describe('air note authors in device data', () => {
    const notes = [
      { id: 1, created_by: 'farmer@example.com', title: 'Vent opened' },
      { id: 2, created_by: 'kevin@cropwatch.io', title: 'QA check' },
    ];

    function createService() {
      const from = jest.fn((table: string) => {
        const builder: Record<string, jest.Mock> = {};
        for (const method of [
          'select',
          'eq',
          'or',
          'lt',
          'lte',
          'gte',
          'order',
          'range',
          'limit',
        ]) {
          builder[method] = jest.fn(() => builder);
        }
        const rows: Record<string, unknown> = {
          cw_devices: { dev_eui: 'DEV-A', type: 7 },
          cw_device_type: { id: 7, data_table_v2: 'cw_air_data' },
        };
        builder.single = jest.fn(() =>
          Promise.resolve({ data: rows[table], error: null }),
        );
        builder.maybeSingle = builder.single;
        (builder as Record<string, unknown>).then = (
          resolve: (value: unknown) => unknown,
        ) =>
          resolve({
            data: [{ id: 100, cw_air_annotations: notes }],
            error: null,
          });
        return builder;
      });
      return new DevicesService(
        {
          getClient: () => ({ from }),
          getAdminClient: jest.fn(),
        } as unknown as SupabaseService,
        {} as LocationsService,
        {} as PaymentsService,
        createAccessMock(),
      );
    }

    const customer = {
      sub: 'u-1',
      email: 'farmer@example.com',
      isStaff: false,
    };
    const staff = { sub: 'u-2', email: 'kevin@cropwatch.io', isStaff: true };
    const authors = (result: { data: unknown[] }) =>
      (
        result.data[0] as {
          cw_air_annotations: { created_by: string | null }[];
        }
      ).cw_air_annotations.map((note) => note.created_by);

    it('hides staff authors from customers in the latest readings', async () => {
      const result = await createService().findData(customer, 'DEV-A');
      expect(authors(result)).toEqual(['farmer@example.com', null]);
    });

    it('hides staff authors from customers in a date range', async () => {
      const result = await createService().findDataWithinRange(
        customer,
        'DEV-A',
        '2026-10-01T00:00:00Z',
        '2026-10-02T00:00:00Z',
      );
      expect(authors(result)).toEqual(['farmer@example.com', null]);
    });

    it('names staff authors to staff', async () => {
      const result = await createService().findData(staff, 'DEV-A');
      expect(authors(result)).toEqual([
        'farmer@example.com',
        'kevin@cropwatch.io',
      ]);
    });
  });
});
