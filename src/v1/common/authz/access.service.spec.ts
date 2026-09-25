import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AccessService } from './access.service';
import { Action } from './actions';
import { SupabaseService } from '../../../supabase/supabase.service';
import type { AuthenticatedUser } from '../../auth/authenticated-user';

describe('AccessService', () => {
  type QueryResult = { data: unknown; error: unknown };

  type QueryBuilder = {
    select: jest.Mock;
    eq: jest.Mock;
    or: jest.Mock;
    maybeSingle: jest.Mock;
    then: (
      resolve: (value: QueryResult) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise<unknown>;
  };

  const createBuilder = (result: QueryResult): QueryBuilder => {
    const builder: QueryBuilder = {
      select: jest.fn(() => builder),
      eq: jest.fn(() => builder),
      or: jest.fn(() => builder),
      maybeSingle: jest.fn(() => Promise.resolve(result)),
      then: (
        resolve: (value: QueryResult) => unknown,
        reject?: (reason: unknown) => unknown,
      ) => Promise.resolve(result).then(resolve, reject),
    };
    return builder;
  };

  const createService = (queues: Record<string, QueryBuilder[]>) => {
    const from = jest.fn((table: string): QueryBuilder => {
      const queue = queues[table];
      if (!queue || queue.length === 0) {
        throw new Error(`No mock builder available for table: ${table}`);
      }
      return queue.shift() as QueryBuilder;
    });
    const service = new AccessService({
      getClient: jest.fn(() => ({ from })),
      getAdminClient: jest.fn(),
    } as unknown as SupabaseService);
    return { service, from };
  };

  const user = (
    overrides: Partial<AuthenticatedUser> = {},
  ): AuthenticatedUser => ({
    sub: 'user-1',
    email: 'farmer@example.com',
    isStaff: false,
    ...overrides,
  });

  describe('getDeviceAccess', () => {
    it('resolves the effective level from the device rows only', async () => {
      const { service } = createService({
        cw_devices: [
          createBuilder({
            data: {
              dev_eui: 'DEV-001',
              user_id: 'someone-else',
              location_id: 4,
              cw_device_owners: [
                { user_id: 'user-1', permission_level: 3 },
                { user_id: 'other', permission_level: 1 },
              ],
            },
            error: null,
          }),
        ],
      });

      const access = await service.getDeviceAccess(user(), 'DEV-001');
      expect(access).toMatchObject({
        exists: true,
        isOwner: false,
        level: 3,
        canRead: true,
        locationId: 4,
        ownerId: 'someone-else',
      });
    });

    it('treats the implicit owner as Admin regardless of rows', async () => {
      const { service } = createService({
        cw_devices: [
          createBuilder({
            data: {
              dev_eui: 'DEV-001',
              user_id: 'user-1',
              location_id: null,
              cw_device_owners: [],
            },
            error: null,
          }),
        ],
      });

      const access = await service.getDeviceAccess(user(), 'DEV-001');
      expect(access).toMatchObject({ isOwner: true, level: 1, canRead: true });
    });

    it('memoizes per user object: two asks, one query', async () => {
      const builder = createBuilder({
        data: {
          dev_eui: 'DEV-001',
          user_id: 'user-1',
          location_id: null,
          cw_device_owners: [],
        },
        error: null,
      });
      const { service, from } = createService({ cw_devices: [builder] });

      const caller = user();
      await service.getDeviceAccess(caller, 'DEV-001');
      await service.getDeviceAccess(caller, 'DEV-001');
      expect(from).toHaveBeenCalledTimes(1);
    });

    it('does not share the memo between different request users', async () => {
      const row = {
        dev_eui: 'DEV-001',
        user_id: 'user-1',
        location_id: null,
        cw_device_owners: [],
      };
      const { service, from } = createService({
        cw_devices: [
          createBuilder({ data: row, error: null }),
          createBuilder({ data: row, error: null }),
        ],
      });

      await service.getDeviceAccess(user(), 'DEV-001');
      await service.getDeviceAccess(user(), 'DEV-001'); // fresh object = new request
      expect(from).toHaveBeenCalledTimes(2);
    });
  });

  describe('assertDeviceAccess', () => {
    const deviceRow = (level: number | null) => ({
      dev_eui: 'DEV-001',
      user_id: 'someone-else',
      location_id: 4,
      cw_device_owners:
        level == null ? [] : [{ user_id: 'user-1', permission_level: level }],
    });

    it('404s when the device does not exist', async () => {
      const { service } = createService({
        cw_devices: [createBuilder({ data: null, error: null })],
      });
      await expect(
        service.assertDeviceAccess(user(), 'DEV-404', Action.DeviceRead),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('404s (not 403) when the device is invisible to the caller', async () => {
      const { service } = createService({
        cw_devices: [createBuilder({ data: deviceRow(5), error: null })],
      });
      await expect(
        service.assertDeviceAccess(user(), 'DEV-001', Action.DeviceRead),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('403s when visible but the action is above the caller’s level', async () => {
      const { service } = createService({
        cw_devices: [createBuilder({ data: deviceRow(4), error: null })],
      });
      await expect(
        service.assertDeviceAccess(user(), 'DEV-001', Action.NoteWrite),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('passes staff without any rows', async () => {
      const { service } = createService({
        cw_devices: [createBuilder({ data: deviceRow(null), error: null })],
      });
      await expect(
        service.assertDeviceAccess(
          user({ isStaff: true, email: 'support@cropwatch.io' }),
          'DEV-001',
          Action.DeviceGrant,
        ),
      ).resolves.toMatchObject({ isStaff: true });
    });
  });

  describe('listAccessibleDevices', () => {
    it('scopes the query for non-staff and computes canView/canManage', async () => {
      const builder = createBuilder({
        data: [
          {
            dev_eui: 'OWNED',
            name: 'Mine',
            user_id: 'user-1',
            owner_match: [],
          },
          {
            dev_eui: 'MANAGED',
            name: 'Managed',
            user_id: 'someone-else',
            owner_match: [{ user_id: 'user-1', permission_level: 2 }],
          },
          {
            dev_eui: 'HIDDEN',
            name: 'Hidden',
            user_id: 'someone-else',
            owner_match: [{ user_id: 'user-1', permission_level: 5 }],
          },
        ],
        error: null,
      });
      const { service } = createService({ cw_devices: [builder] });

      const devices = await service.listAccessibleDevices(user());
      expect(devices).toEqual([
        {
          devEui: 'OWNED',
          name: 'Mine',
          permissionLevel: 1,
          canView: true,
          canManage: true,
        },
        {
          devEui: 'MANAGED',
          name: 'Managed',
          permissionLevel: 2,
          canView: true,
          canManage: true,
        },
        {
          devEui: 'HIDDEN',
          name: 'Hidden',
          permissionLevel: 5,
          canView: false,
          canManage: false,
        },
      ]);
      // Scoped to the caller — not the old full-table scan.
      expect(builder.eq).toHaveBeenCalledTimes(1);
      expect(builder.or).toHaveBeenCalledTimes(1);
    });

    it('applies no filters for staff', async () => {
      const builder = createBuilder({ data: [], error: null });
      const { service } = createService({ cw_devices: [builder] });

      await service.listAccessibleDevices(
        user({ isStaff: true, email: 'support@cropwatch.io' }),
      );
      expect(builder.eq).not.toHaveBeenCalled();
      expect(builder.or).not.toHaveBeenCalled();
    });
  });

  describe('assertDevicesManageable', () => {
    const rows = [
      {
        dev_eui: 'MANAGED',
        name: null,
        user_id: 'someone-else',
        owner_match: [{ user_id: 'user-1', permission_level: 2 }],
      },
      {
        dev_eui: 'VIEW-ONLY',
        name: null,
        user_id: 'someone-else',
        owner_match: [{ user_id: 'user-1', permission_level: 4 }],
      },
    ];

    it('passes when every device is manageable', async () => {
      const { service } = createService({
        cw_devices: [createBuilder({ data: rows, error: null })],
      });
      await expect(
        service.assertDevicesManageable(user(), ['MANAGED']),
      ).resolves.toBeUndefined();
    });

    it('throws Forbidden when any device is not manageable', async () => {
      const { service } = createService({
        cw_devices: [createBuilder({ data: rows, error: null })],
      });
      await expect(
        service.assertDevicesManageable(user(), ['MANAGED', 'VIEW-ONLY']),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('does nothing for an empty list', async () => {
      const { service, from } = createService({});
      await expect(
        service.assertDevicesManageable(user(), []),
      ).resolves.toBeUndefined();
      expect(from).not.toHaveBeenCalled();
    });
  });
});
