import {
  deviceLocationEmbed,
  groupName,
  withDeviceGroup,
  withLocationGroup,
} from './group-columns';

describe('group columns', () => {
  it('reads an embedded group as an object or a one-row list', () => {
    expect(groupName({ name: 'Barn' })).toBe('Barn');
    expect(groupName([{ name: 'Barn' }])).toBe('Barn');
    expect(groupName([])).toBeNull();
    expect(groupName(null)).toBeNull();
    expect(groupName(undefined)).toBeNull();
  });

  it('returns a location as before 038: the group name, no group_id or embed', () => {
    expect(
      withLocationGroup({
        location_id: 1,
        name: 'North',
        group_id: 4,
        // The text column is stale until 039 drops it; the embed wins.
        group: 'stale',
        location_group: { name: 'Farm A' },
      }),
    ).toEqual({ location_id: 1, name: 'North', group: 'Farm A' });
    expect(withLocationGroup({ location_id: 2, group_id: null })).toEqual({
      location_id: 2,
      group: null,
    });
  });

  it('returns a device as before 038: the group name, no group_id or embed', () => {
    expect(
      withDeviceGroup({
        dev_eui: 'D1',
        group_id: 9,
        // The text column is stale until 039 drops it; the embed wins.
        group: 'stale',
        device_group: [{ name: 'Sensors' }],
      }),
    ).toEqual({ dev_eui: 'D1', group: 'Sensors' });
  });

  it('builds the location embed of a device query', () => {
    expect(deviceLocationEmbed('location_id, name')).toBe(
      'cw_locations(location_id, name, location_group:cw_location_groups(name))',
    );
    expect(deviceLocationEmbed('location_id', { inner: true })).toBe(
      'cw_locations!inner(location_id, location_group:cw_location_groups(name))',
    );
    // Filtering by location group drops devices outside it outright.
    expect(deviceLocationEmbed('location_id', { groupFilter: true })).toBe(
      'cw_locations!inner(location_id, location_group:cw_location_groups!inner(name))',
    );
  });
});
