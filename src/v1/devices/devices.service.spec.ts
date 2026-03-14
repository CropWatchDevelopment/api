import { Test, TestingModule } from '@nestjs/testing';
import { DevicesService } from './devices.service';
import { SupabaseService } from '../../supabase/supabase.service';

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
});
