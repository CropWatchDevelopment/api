import { InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { LocationsService } from './locations.service';
import { SupabaseService } from '../../supabase/supabase.service';

describe('LocationsService', () => {
  type QueryResult = { data: any; error: any };

  const createBuilder = (result: QueryResult) => {
    const builder: any = {
      data: result.data,
      error: result.error,
      select: jest.fn(() => builder),
      eq: jest.fn(() => builder),
      gt: jest.fn(() => builder),
      or: jest.fn(() => builder),
      order: jest.fn(() => builder),
      maybeSingle: jest.fn(async () => result),
      single: jest.fn(async () => result),
      upsert: jest.fn(() => builder),
      insert: jest.fn(() => builder),
      delete: jest.fn(() => builder),
    };
    return builder;
  };

  const createClient = (queues: Record<string, any[]>) => ({
    from: jest.fn((table: string) => {
      const tableQueue = queues[table];
      if (!tableQueue || tableQueue.length === 0) {
        throw new Error(`No mock builder available for table: ${table}`);
      }
      return tableQueue.shift();
    }),
  });

  const createService = (client: any) =>
    new LocationsService({
      getClient: jest.fn(() => client),
      getAdminClient: jest.fn(),
    } as unknown as SupabaseService);

  it('should be defined', () => {
    const client = createClient({});
    const service = createService(client);
    expect(service).toBeDefined();
  });

  it('findOne should return 404 when location is not found', async () => {
    const locationQuery = createBuilder({ data: null, error: null });
    const client = createClient({
      cw_locations: [locationQuery],
    });
    const service = createService(client);

    await expect(service.findOne(123, { sub: 'user-1' }, 'Bearer token-1')).rejects.toBeInstanceOf(NotFoundException);
    expect(locationQuery.maybeSingle).toHaveBeenCalledTimes(1);
  });

  it('updateLocationPermission should not clean up when a device permission upsert fails', async () => {
    const permissionCheckQuery = createBuilder({ data: { location_id: 77 }, error: null });
    const locationOwnerUpsertQuery = createBuilder({ data: { id: 1 }, error: null });
    const locationDevicesQuery = createBuilder({
      data: [{ dev_eui: 'ABC123' }, { dev_eui: 'XYZ789' }],
      error: null,
    });
    const failingDeviceOwnerUpsertQuery = createBuilder({
      data: null,
      error: { message: 'write failed' },
    });

    const client = createClient({
      cw_locations: [permissionCheckQuery],
      cw_location_owners: [locationOwnerUpsertQuery],
      cw_devices: [locationDevicesQuery],
      cw_device_owners: [failingDeviceOwnerUpsertQuery],
    });
    const service = createService(client);

    await expect(
      service.updateLocationPermission(
        77,
        {
          user_id: 'member-1',
          permission_level: 5,
          is_active: true,
        },
        true,
        { sub: 'admin-1' },
        'Bearer token-1',
      ),
    ).rejects.toBeInstanceOf(InternalServerErrorException);

    // Assert we made no rollback/cleanup attempts.
    const calledTables = client.from.mock.calls.map(([table]: [string]) => table);
    expect(calledTables).toEqual(['cw_locations', 'cw_location_owners', 'cw_devices', 'cw_device_owners']);
    expect(locationOwnerUpsertQuery.delete).not.toHaveBeenCalled();
    expect(failingDeviceOwnerUpsertQuery.delete).not.toHaveBeenCalled();
  });
});
