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
        // Org context and location grants default to empty unless a test
        // supplies them explicitly.
        if (
          table === 'organization_members' ||
          table === 'cw_location_owners'
        ) {
          return createBuilder({ data: [], error: null });
        }
        throw new Error(`No mock builder available for table: ${table}`);
      }
      return queue.shift() as QueryBuilder;
    });
    const service = new AccessService(
      {
        getClient: jest.fn(() => ({ from })),
        getAdminClient: jest.fn(),
      } as unknown as SupabaseService,
      {
        get: jest.fn(() => undefined),
      } as unknown as import('@nestjs/config').ConfigService,
    );
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
      // 1 device fetch + 1 org-context fetch, each memoized.
      expect(from).toHaveBeenCalledTimes(2);
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
      // (device + org context) per request user.
      expect(from).toHaveBeenCalledTimes(4);
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

describe('AccessService — org overlay', () => {
  type QueryResult = { data: unknown; error: unknown };
  type QueryBuilder = {
    select: jest.Mock;
    eq: jest.Mock;
    is: jest.Mock;
    or: jest.Mock;
    maybeSingle: jest.Mock;
    then: (
      resolve: (value: QueryResult) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise<unknown>;
  };
  const builder = (result: QueryResult): QueryBuilder => {
    const b: QueryBuilder = {
      select: jest.fn(() => b),
      eq: jest.fn(() => b),
      is: jest.fn(() => b),
      or: jest.fn(() => b),
      maybeSingle: jest.fn(() => Promise.resolve(result)),
      then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
    };
    return b;
  };

  const ORG = '11111111-1111-4111-8111-111111111111';
  const CHILD = '22222222-2222-4222-8222-222222222222';
  const OTHER = '33333333-3333-4333-8333-333333333333';

  const membership = (over: Record<string, unknown> = {}) => ({
    org_id: ORG,
    role: 'manager',
    status: 'active',
    expires_at: null,
    organizations: {
      id: ORG,
      type: 'company',
      name: 'Acme Farms',
      deactivated_at: null,
    },
    ...over,
  });

  const deviceRow = (
    orgId: string | null,
    over: Record<string, unknown> = {},
  ) => ({
    dev_eui: 'DEV-001',
    user_id: 'someone-else',
    location_id: 4,
    org_id: orgId,
    cw_device_owners: [],
    ...over,
  });

  const make = (queues: Record<string, QueryBuilder[]>) => {
    const from = jest.fn((table: string): QueryBuilder => {
      const queue = queues[table];
      if (queue && queue.length > 0) return queue.shift() as QueryBuilder;
      if (table === 'organization_members' || table === 'cw_location_owners')
        return builder({ data: [], error: null });
      if (table === 'organizations') return builder({ data: [], error: null });
      throw new Error(`Unexpected table ${table}`);
    });
    return new AccessService(
      {
        getClient: jest.fn(() => ({ from })),
        getAdminClient: jest.fn(),
      } as unknown as SupabaseService,
      {
        get: jest.fn(() => undefined),
      } as unknown as import('@nestjs/config').ConfigService,
    );
  };
  const caller = (): AuthenticatedUser => ({
    sub: 'user-1',
    email: 'manager@example.com',
    isStaff: false,
  });

  it('an org manager has manage access to an org device without any grant rows', async () => {
    const service = make({
      organization_members: [builder({ data: [membership()], error: null })],
      cw_devices: [builder({ data: deviceRow(ORG), error: null })],
    });
    const u = caller();
    const access = await service.assertDeviceAccess(
      u,
      'DEV-001',
      Action.DeviceEdit,
    );
    expect(access.orgRole).toBe('manager');
    // ...but replacing a device stays owner-only.
    await expect(
      service.assertDeviceAccess(u, 'DEV-001', Action.DeviceReplace),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('a parent-org manager can read but not edit a child-org device', async () => {
    const service = make({
      organization_members: [builder({ data: [membership()], error: null })],
      organizations: [builder({ data: [{ id: CHILD }], error: null })],
      cw_devices: [builder({ data: deviceRow(CHILD), error: null })],
    });
    const u = caller();
    const access = await service.assertDeviceAccess(
      u,
      'DEV-001',
      Action.DeviceRead,
    );
    expect(access.parentRead).toBe(true);
    await expect(
      service.assertDeviceAccess(u, 'DEV-001', Action.DeviceEdit),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('a device in an unrelated org stays a 404', async () => {
    const service = make({
      organization_members: [builder({ data: [membership()], error: null })],
      cw_devices: [builder({ data: deviceRow(OTHER), error: null })],
    });
    await expect(
      service.assertDeviceAccess(caller(), 'DEV-001', Action.DeviceRead),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('a suspended member gets 404 even with a grant row (dormant, not deleted)', async () => {
    const service = make({
      organization_members: [
        builder({
          data: [membership({ status: 'suspended', role: 'member' })],
          error: null,
        }),
      ],
      cw_devices: [
        builder({
          data: deviceRow(ORG, {
            cw_device_owners: [{ user_id: 'user-1', permission_level: 3 }],
          }),
          error: null,
        }),
      ],
    });
    await expect(
      service.assertDeviceAccess(caller(), 'DEV-001', Action.DeviceRead),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('a guest grant is capped at Viewer even when the row says User', async () => {
    const service = make({
      organization_members: [
        builder({
          data: [membership({ role: 'guest' })],
          error: null,
        }),
      ],
      cw_devices: [
        builder({
          data: deviceRow(ORG, {
            cw_device_owners: [{ user_id: 'user-1', permission_level: 3 }],
          }),
          error: null,
        }),
      ],
    });
    const u = caller();
    const access = await service.getDeviceAccess(u, 'DEV-001');
    expect(access.level).toBe(4);
    expect(access.canRead).toBe(true);
    await expect(
      service.assertDeviceAccess(u, 'DEV-001', Action.NoteWrite),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('with no device override, the location default applies (member grant)', async () => {
    const service = make({
      organization_members: [
        builder({ data: [membership({ role: 'member' })], error: null }),
      ],
      cw_location_owners: [
        builder({
          data: [{ location_id: 4, permission_level: 3 }],
          error: null,
        }),
      ],
      cw_devices: [builder({ data: deviceRow(ORG), error: null })],
    });
    const access = await service.getDeviceAccess(caller(), 'DEV-001');
    expect(access.level).toBe(3); // location default, no fan-out row needed
    expect(access.canRead).toBe(true);
  });

  it('a Disabled device override hides the device despite a location default', async () => {
    const service = make({
      organization_members: [
        builder({ data: [membership({ role: 'member' })], error: null }),
      ],
      cw_location_owners: [
        builder({
          data: [{ location_id: 4, permission_level: 3 }],
          error: null,
        }),
      ],
      cw_devices: [
        builder({
          data: deviceRow(ORG, {
            cw_device_owners: [{ user_id: 'user-1', permission_level: 5 }],
          }),
          error: null,
        }),
      ],
    });
    await expect(
      service.assertDeviceAccess(caller(), 'DEV-001', Action.DeviceRead),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('assertOrgAction: manager may open Management but not Settings; outsiders get 404', async () => {
    const service = make({
      organization_members: [builder({ data: [membership()], error: null })],
    });
    const u = caller();
    await expect(
      service.assertOrgAction(u, ORG, Action.OrgManageOpen),
    ).resolves.toMatchObject({ org: { role: 'manager' } });
    await expect(
      service.assertOrgAction(u, ORG, Action.OrgSettingsManage),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.assertOrgAction(u, OTHER, Action.OrgRead),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('AccessService — ORG_OVERLAY_DISABLED kill-switch', () => {
  it('collapses resolution to grants-only (pre-organizations behavior)', async () => {
    const from = jest.fn(() => {
      throw new Error('the overlay must not query anything when disabled');
    });
    const service = new AccessService(
      {
        getClient: jest.fn(() => ({ from })),
        getAdminClient: jest.fn(),
      } as unknown as SupabaseService,
      {
        get: jest.fn((key: string) =>
          key === 'ORG_OVERLAY_DISABLED' ? 'true' : undefined,
        ),
      } as unknown as import('@nestjs/config').ConfigService,
    );

    const ctx = await service.getOrgContext({
      sub: 'user-1',
      email: 'owner@example.com',
      isStaff: false,
    });
    expect(ctx.org).toBeNull();
    expect(ctx.managedOrgIds).toEqual([]);
    expect(ctx.parentReadOrgIds).toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });
});
