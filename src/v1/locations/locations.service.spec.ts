import {
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { LocationsService } from './locations.service';
import { SupabaseService } from '../../supabase/supabase.service';
import type { AccessService, LocationAccess } from '../common/authz';
import type { AuthenticatedUser } from '../auth/authenticated-user';

describe('LocationsService', () => {
  type QueryResult = { data: unknown; error: unknown };

  type QueryBuilder = {
    data: unknown;
    error: unknown;
    select: jest.Mock;
    eq: jest.Mock;
    gt: jest.Mock;
    lt: jest.Mock;
    lte: jest.Mock;
    or: jest.Mock;
    not: jest.Mock;
    order: jest.Mock;
    maybeSingle: jest.Mock;
    single: jest.Mock;
    upsert: jest.Mock;
    insert: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };

  const createBuilder = (result: QueryResult): QueryBuilder => {
    const builder: QueryBuilder = {
      data: result.data,
      error: result.error,
      select: jest.fn(() => builder),
      eq: jest.fn(() => builder),
      gt: jest.fn(() => builder),
      lt: jest.fn(() => builder),
      lte: jest.fn(() => builder),
      or: jest.fn(() => builder),
      not: jest.fn(() => builder),
      order: jest.fn(() => builder),
      maybeSingle: jest.fn(() => Promise.resolve(result)),
      single: jest.fn(() => Promise.resolve(result)),
      upsert: jest.fn(() => builder),
      insert: jest.fn(() => builder),
      update: jest.fn(() => builder),
      delete: jest.fn(() => builder),
    };
    return builder;
  };

  const createClient = (queues: Record<string, QueryBuilder[]>) => ({
    from: jest.fn((table: string): QueryBuilder => {
      const tableQueue = queues[table];
      if (!tableQueue || tableQueue.length === 0) {
        throw new Error(`No mock builder available for table: ${table}`);
      }
      return tableQueue.shift() as QueryBuilder;
    }),
  });

  const locationAccess = (
    overrides: Partial<LocationAccess> = {},
  ): LocationAccess => ({
    exists: true,
    locationId: 1,
    orgId: null,
    orgRole: null,
    parentRead: false,
    ownerId: 'owner-9',
    isStaff: false,
    isOwner: false,
    level: 1,
    canRead: true,
    ...overrides,
  });

  const createAccessService = () =>
    ({
      assertLocationAccess: jest.fn(),
      getLocationAccess: jest.fn(),
      getReadableOrgIds: jest.fn().mockResolvedValue([]),
      getManagedOrgIds: jest.fn().mockResolvedValue([]),
    }) as unknown as AccessService & {
      assertLocationAccess: jest.Mock;
      getLocationAccess: jest.Mock;
    };

  const createService = (
    client: ReturnType<typeof createClient>,
    accessService = createAccessService(),
  ) => {
    const service = new LocationsService(
      {
        getClient: jest.fn(() => client),
        getAdminClient: jest.fn(),
      } as unknown as SupabaseService,
      accessService,
    );
    return { service, accessService };
  };

  const USER: AuthenticatedUser = {
    sub: 'user-1',
    email: 'farmer@example.com',
    isStaff: false,
  };

  it('should be defined', () => {
    const client = createClient({});
    const { service } = createService(client);
    expect(service).toBeDefined();
  });

  it('findOne should return 404 when location is not found', async () => {
    const locationQuery = createBuilder({ data: null, error: null });
    const client = createClient({
      cw_locations: [locationQuery],
    });
    const { service } = createService(client);

    await expect(
      service.findOne(123, { sub: 'user-1', email: null, isStaff: false }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(locationQuery.maybeSingle).toHaveBeenCalledTimes(1);
  });

  it('findOne should allow cropwatch staff to bypass ownership filters', async () => {
    const staffOwnerRow = {
      user_id: 'staff-2',
      profiles: { email: 'support@cropwatch.io' },
    };
    const locationQuery = createBuilder({
      data: {
        location_id: 83,
        name: 'Staff Visible',
        cw_location_owners: [staffOwnerRow],
      },
      error: null,
    });
    const client = createClient({
      cw_locations: [locationQuery],
    });
    const { service } = createService(client);

    await expect(
      service.findOne(83, {
        sub: 'staff-1',
        email: 'staff@cropwatch.io',
        isStaff: true,
      }),
    ).resolves.toEqual({
      location_id: 83,
      name: 'Staff Visible',
      cw_location_owners: [staffOwnerRow],
    });

    // Staff skip every scope filter: only the primary-key eq is applied.
    expect(locationQuery.eq).toHaveBeenCalledTimes(1);
    expect(locationQuery.eq).toHaveBeenCalledWith('location_id', 83);
    expect(locationQuery.or).not.toHaveBeenCalled();
  });

  it('findOne should hide staff permission rows from non-staff users', async () => {
    const customerOwnerRow = {
      user_id: 'member-1',
      profiles: { email: 'farmer@example.com' },
    };
    const locationQuery = createBuilder({
      data: {
        location_id: 84,
        name: 'Customer Location',
        cw_location_owners: [
          customerOwnerRow,
          { user_id: 'staff-2', profiles: { email: 'support@cropwatch.io' } },
        ],
      },
      error: null,
    });
    const client = createClient({
      cw_locations: [locationQuery],
    });
    const { service } = createService(client);

    await expect(service.findOne(84, USER)).resolves.toEqual({
      location_id: 84,
      name: 'Customer Location',
      cw_location_owners: [customerOwnerRow],
    });
  });

  it('update lets a Manager rename without filtering on owner_id (regression: 500 for Managers)', async () => {
    const updateQuery = createBuilder({
      data: { location_id: 5, name: 'Renamed' },
      error: null,
    });
    const client = createClient({ cw_locations: [updateQuery] });
    const { service, accessService } = createService(client);
    accessService.assertLocationAccess.mockResolvedValue(
      locationAccess({ locationId: 5, level: 2 }), // Manager, not the owner
    );

    await expect(
      service.update(5, { name: 'Renamed', group: null }, USER),
    ).resolves.toEqual({ location_id: 5, name: 'Renamed' });

    // The update filters by primary key only — the permission gate already
    // ran. (The old code re-filtered on owner_id, which 500'd for Managers.)
    expect(updateQuery.eq).toHaveBeenCalledTimes(1);
    expect(updateQuery.eq).toHaveBeenCalledWith('location_id', 5);
    expect(updateQuery.maybeSingle).toHaveBeenCalledTimes(1);
  });

  it('findAllLocationGroups uses the shared read scope (regression: shared locations were hidden)', async () => {
    const groupsQuery = createBuilder({
      data: [{ group: 'North' }, { group: 'North' }, { group: 'South' }],
      error: null,
    });
    const client = createClient({ cw_locations: [groupsQuery] });
    const { service } = createService(client);

    await expect(service.findAllLocationGroups(USER)).resolves.toEqual([
      'North',
      'South',
    ]);

    // Exactly one eq (the scope's owner-row match) — the old code added a
    // second, ANDed owner_id filter that collapsed the scope to owned-only.
    expect(groupsQuery.eq).toHaveBeenCalledTimes(1);
    expect(groupsQuery.or).toHaveBeenCalledTimes(1);
  });

  it('updateUserPermissionLevel writes to the ROUTE location only (regression: cross-location escalation)', async () => {
    const grantCheckQuery = createBuilder({
      data: { permission_level: 3 },
      error: null,
    });
    const ownerUpdateQuery = createBuilder({ data: { id: 1 }, error: null });
    const profilesQuery = createBuilder({
      data: { id: 'member-1' },
      error: null,
    });
    const client = createClient({
      profiles: [profilesQuery],
      cw_location_owners: [grantCheckQuery, ownerUpdateQuery],
    });
    const { service, accessService } = createService(client);
    accessService.assertLocationAccess.mockResolvedValue(
      locationAccess({ locationId: 7 }),
    );

    await expect(
      service.updateUserPermissionLevel(
        7,
        { email: 'member@example.com', permission_level: 4 },
        false,
        USER,
      ),
    ).resolves.toEqual({
      message: 'Location permission level successfully updated',
    });

    // Both the grant-ceiling read and the write are pinned to the route id.
    expect(grantCheckQuery.eq).toHaveBeenCalledWith('location_id', 7);
    expect(ownerUpdateQuery.eq).toHaveBeenCalledWith('location_id', 7);
    expect(ownerUpdateQuery.update).toHaveBeenCalledWith({
      permission_level: 4,
      is_active: true,
    });
  });

  it('updateUserPermissionLevel enforces the grant ceiling (Manager cannot grant Admin)', async () => {
    const grantCheckQuery = createBuilder({
      data: null, // target has no existing row
      error: null,
    });
    const profilesQuery = createBuilder({
      data: { id: 'member-1' },
      error: null,
    });
    const client = createClient({
      profiles: [profilesQuery],
      cw_location_owners: [grantCheckQuery],
    });
    const { service, accessService } = createService(client);
    accessService.assertLocationAccess.mockResolvedValue(
      locationAccess({ locationId: 7, level: 2 }), // actor is a Manager
    );

    await expect(
      service.updateUserPermissionLevel(
        7,
        { email: 'member@example.com', permission_level: 1 },
        false,
        USER,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('removeLocationPermission refuses to remove the implicit owner’s row', async () => {
    const permissionRecordQuery = createBuilder({
      data: { id: 42, user_id: 'owner-9', permission_level: 1 },
      error: null,
    });
    const client = createClient({
      cw_location_owners: [permissionRecordQuery],
    });
    const { service, accessService } = createService(client);
    accessService.assertLocationAccess.mockResolvedValue(
      locationAccess({ locationId: 9, ownerId: 'owner-9', level: 1 }),
    );

    await expect(
      service.removeLocationPermission(9, 42, USER),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(permissionRecordQuery.delete).not.toHaveBeenCalled();
  });

  it('updateLocationPermission should not clean up when a device permission upsert fails', async () => {
    const grantCheckQuery = createBuilder({
      data: { permission_level: 4 },
      error: null,
    });
    const locationOwnerUpsertQuery = createBuilder({
      data: { id: 1 },
      error: null,
    });
    const locationDevicesQuery = createBuilder({
      data: [{ dev_eui: 'ABC123' }, { dev_eui: 'XYZ789' }],
      error: null,
    });
    const failingDeviceOwnerUpsertQuery = createBuilder({
      data: null,
      error: { message: 'write failed' },
    });

    const client = createClient({
      cw_location_owners: [grantCheckQuery, locationOwnerUpsertQuery],
      cw_devices: [locationDevicesQuery],
      cw_device_owners: [failingDeviceOwnerUpsertQuery],
    });
    const { service, accessService } = createService(client);
    accessService.assertLocationAccess.mockResolvedValue(
      locationAccess({ locationId: 77 }),
    );

    await expect(
      service.updateLocationPermission(
        77,
        {
          user_id: 'member-1',
          permission_level: 5,
          is_active: true,
        },
        true,
        { sub: 'admin-1', email: null, isStaff: false },
      ),
    ).rejects.toBeInstanceOf(InternalServerErrorException);

    // Assert we made no rollback/cleanup attempts.
    const calledTables = client.from.mock.calls.map(
      ([table]: [string]) => table,
    );
    expect(calledTables).toEqual([
      'cw_location_owners',
      'cw_location_owners',
      'cw_devices',
      'cw_device_owners',
    ]);
    expect(locationOwnerUpsertQuery.delete).not.toHaveBeenCalled();
    expect(failingDeviceOwnerUpsertQuery.delete).not.toHaveBeenCalled();
  });
});
