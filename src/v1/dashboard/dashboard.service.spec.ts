import { DashboardService } from './dashboard.service';
import { SupabaseService } from '../../supabase/supabase.service';
import { TimezoneFormatterService } from '../common/timezone-formatter.service';
import { AccessService, type AccessibleDevice } from '../common/authz';
import type { AuthenticatedUser } from '../auth/authenticated-user';

const airType = {
  id: 1,
  name: 'Air sensor',
  data_table_v2: 'cw_air_data',
  primary_data_v2: 'temperature_c',
  secondary_data_v2: 'humidity',
  default_upload_interval: 10,
};

const device = (devEui: string) => ({
  dev_eui: devEui,
  name: devEui,
  device_group: null,
  upload_interval: 10,
  last_data_updated_at: null,
  error_status: null,
  location_id: 7,
  cw_device_type: airType,
  cw_locations: { location_id: 7, name: 'Greenhouse', location_group: null },
});

const accessible = (
  devEui: string,
  canWriteNotes: boolean,
): AccessibleDevice => ({
  devEui,
  name: devEui,
  orgId: null,
  groupId: null,
  permissionLevel: canWriteNotes ? 3 : 4,
  canView: true,
  canManage: false,
  canWriteNotes,
});

// Every chain resolves to the table's rows; maybeSingle to its first row.
function tableStub(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const method of [
    'select',
    'eq',
    'in',
    'or',
    'lt',
    'ilike',
    'order',
    'range',
    'limit',
  ]) {
    chain[method] = jest.fn(() => chain);
  }
  chain.maybeSingle = jest
    .fn()
    .mockResolvedValue({ data: rows[0] ?? null, error: null });
  chain.then = (resolve: (value: unknown) => unknown) =>
    resolve({ data: rows, count: rows.length, error: null });
  return chain;
}

function serviceWith(
  accessibleDevices: AccessibleDevice[],
  devices: unknown[] = [device('USER-DEV'), device('VIEWER-DEV')],
) {
  const tables: Record<string, unknown[]> = {
    cw_devices: devices,
    cw_air_data: [{ created_at: '2026-10-30T00:00:00Z', temperature_c: 21 }],
  };
  const listAccessibleDevices = jest.fn().mockResolvedValue(accessibleDevices);
  const service = new DashboardService(
    {
      getClient: () => ({ from: (table: string) => tableStub(tables[table]) }),
    } as unknown as SupabaseService,
    {} as TimezoneFormatterService,
    {
      getReadableOrgIds: jest.fn().mockResolvedValue([]),
      listAccessibleDevices,
    } as unknown as AccessService,
  );
  return { service, listAccessibleDevices };
}

const customer: AuthenticatedUser = {
  sub: 'user-1',
  email: 'farmer@example.com',
  isStaff: false,
};
const staff: AuthenticatedUser = {
  sub: 'staff-1',
  email: 'kevin@cropwatch.io',
  isStaff: true,
};

describe('DashboardService can_write_notes', () => {
  const access = [
    accessible('USER-DEV', true),
    accessible('VIEWER-DEV', false),
  ];

  it('marks only the devices the caller may write notes on (device list)', async () => {
    const { service } = serviceWith(access);

    const page = await service.getDevices(customer, {});

    expect(page.rows.map((row) => [row.dev_eui, row.can_write_notes])).toEqual([
      ['USER-DEV', true],
      ['VIEWER-DEV', false],
    ]);
  });

  it('marks only the devices the caller may write notes on (location groups)', async () => {
    const { service } = serviceWith(access);

    const page = await service.getLocations(customer, {});

    expect(
      page.groups
        .flatMap((group) => group.devices)
        .map((row) => [row.dev_eui, row.can_write_notes]),
    ).toEqual([
      ['USER-DEV', true],
      ['VIEWER-DEV', false],
    ]);
  });

  it('lets staff write notes everywhere without listing every device', async () => {
    const { service, listAccessibleDevices } = serviceWith([]);

    const page = await service.getDevices(staff, {});

    expect(page.rows.every((row) => row.can_write_notes)).toBe(true);
    expect(listAccessibleDevices).not.toHaveBeenCalled();
  });
});

describe('DashboardService natural order', () => {
  const named = (
    devEui: string,
    name: string,
    location = { location_id: 7, name: 'Greenhouse', group: null },
  ) => ({
    ...device(devEui),
    name,
    location_id: location.location_id,
    cw_locations: location,
  });

  it('sorts every matching device by name before cutting the page', async () => {
    const { service } = serviceWith(
      [],
      [
        named('D1', 'センサー10'),
        named('D2', '⑥ハウス'),
        named('D3', 'センサー2'),
        named('D4', 'apple'),
        named('D5', '1号舎'),
        named('D6', 'センサー2'),
      ],
    );

    const first = await service.getDevices(staff, { take: 3 });
    const second = await service.getDevices(staff, { skip: 3, take: 3 });

    expect(first.total).toBe(6);
    expect(first.rows.map((row) => [row.dev_eui, row.name])).toEqual([
      ['D5', '1号舎'],
      ['D2', '⑥ハウス'],
      ['D4', 'apple'],
    ]);
    expect(second.rows.map((row) => [row.dev_eui, row.name])).toEqual([
      ['D3', 'センサー2'],
      ['D6', 'センサー2'],
      ['D1', 'センサー10'],
    ]);
  });

  it('orders kanji names by the request language', async () => {
    const { service } = serviceWith(
      [],
      [named('D1', '温室'), named('D2', '五反田')],
    );

    const ja = await service.getDevices(staff, { locale: 'ja' });
    const en = await service.getDevices(staff, { locale: 'en-US,en;q=0.9' });

    expect(ja.rows.map((row) => row.name)).toEqual(['温室', '五反田']);
    expect(en.rows.map((row) => row.name)).toEqual(['五反田', '温室']);
  });

  it('returns an empty page past the last device', async () => {
    const { service } = serviceWith([], [named('D1', 'A')]);

    const page = await service.getDevices(staff, { skip: 50 });

    expect(page).toEqual({ rows: [], total: 1, skip: 50, take: 50 });
  });

  it('orders locations, and the devices inside each one, naturally', async () => {
    const house10 = { location_id: 1, name: '10号棟', group: null };
    const house2 = { location_id: 2, name: '２号棟', group: null };
    const { service } = serviceWith(
      [],
      [
        named('D1', 'センサー10', house10),
        named('D2', 'センサー１', house2),
        named('D3', 'センサー2', house10),
        named('D4', 'センサー１', house10),
      ],
    );

    const page = await service.getLocations(staff, {});

    expect(
      page.groups.map((group) => [
        group.location?.name,
        group.devices.map((row) => row.name),
      ]),
    ).toEqual([
      ['２号棟', ['センサー１']],
      ['10号棟', ['センサー１', 'センサー2', 'センサー10']],
    ]);
  });
});

describe('DashboardService groups (038)', () => {
  const grouped = {
    ...device('GROUPED'),
    device_group: { name: 'Sensors' },
    cw_locations: {
      location_id: 7,
      name: 'Greenhouse',
      location_group: { name: 'Farm A' },
    },
  };

  /** Like serviceWith, but keeps every cw_devices chain for inspection. */
  function recordingService(devices: unknown[]) {
    const chains: Record<string, jest.Mock>[] = [];
    const service = new DashboardService(
      {
        getClient: () => ({
          from: (table: string) => {
            const chain = tableStub(
              table === 'cw_devices'
                ? devices
                : [{ created_at: '2026-10-30T00:00:00Z', temperature_c: 21 }],
            );
            if (table === 'cw_devices') {
              chains.push(chain as Record<string, jest.Mock>);
            }
            return chain;
          },
        }),
      } as unknown as SupabaseService,
      {} as TimezoneFormatterService,
      {
        getReadableOrgIds: jest.fn().mockResolvedValue([]),
        listAccessibleDevices: jest.fn().mockResolvedValue([]),
      } as unknown as AccessService,
    );
    return { service, chains };
  }

  const selects = (chain: Record<string, jest.Mock>) =>
    chain.select.mock.calls.map(([columns]) => String(columns)).join(' ');

  it('returns the device and location group names, as before', async () => {
    const { service, chains } = recordingService([grouped]);

    const page = await service.getDevices(staff, {});

    // Step 2 (the page's full rows) embeds both group names.
    expect(selects(chains[1])).toContain('device_group:cw_device_groups(name)');
    expect(selects(chains[1])).toContain(
      'location_group:cw_location_groups(name)',
    );

    expect(page.rows[0]).toMatchObject({
      group: 'Sensors',
      location: { location_id: 7, name: 'Greenhouse', group: 'Farm A' },
    });

    const locations = await service.getLocations(staff, {});
    expect(locations.groups[0].location).toEqual({
      location_id: 7,
      name: 'Greenhouse',
      group: 'Farm A',
    });
  });

  it('filters by device group and location group through the group tables', async () => {
    const { service, chains } = recordingService([grouped]);

    await service.getDevices(staff, { group: 'sens', locationGroup: 'Farm A' });

    const [match] = chains;
    expect(selects(match)).toContain(
      'device_group:cw_device_groups!inner(name)',
    );
    expect(selects(match)).toContain(
      'cw_locations!inner(location_id, name, location_group:cw_location_groups!inner(name))',
    );
    expect(match.ilike).toHaveBeenCalledWith('device_group.name', '%sens%');
    expect(match.eq).toHaveBeenCalledWith(
      'cw_locations.location_group.name',
      'Farm A',
    );
  });

  it('filters the location list the same way', async () => {
    const { service, chains } = recordingService([grouped]);

    await service.getLocations(staff, {
      group: 'sens',
      locationGroup: 'Farm A',
    });

    const [locs, devices] = chains;
    // Inner at both levels, so locations outside the group drop out.
    expect(selects(locs)).toContain(
      'cw_locations!inner(location_id, name, location_group:cw_location_groups!inner(name))',
    );
    expect(selects(locs)).toContain(
      'device_group:cw_device_groups!inner(name)',
    );
    expect(locs.ilike).toHaveBeenCalledWith('device_group.name', '%sens%');
    expect(locs.eq).toHaveBeenCalledWith(
      'cw_locations.location_group.name',
      'Farm A',
    );
    expect(selects(devices)).toContain(
      'device_group:cw_device_groups!inner(name)',
    );
    expect(devices.ilike).toHaveBeenCalledWith('device_group.name', '%sens%');
  });
});
