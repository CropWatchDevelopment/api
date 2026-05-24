import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { SupabaseService } from '../../supabase/supabase.service';
import { RulesNewService } from './rules-new.service';

type StubResult = { data: unknown; error: unknown };

interface QueryStub {
  select: jest.Mock;
  insert: jest.Mock;
  update: jest.Mock;
  delete: jest.Mock;
  eq: jest.Mock;
  in: jest.Mock;
  single: jest.Mock;
  maybeSingle: jest.Mock;
  then: (resolve: (value: StubResult) => unknown) => unknown;
}

function buildQueryStub(handlers: {
  list?: StubResult;
  single?: StubResult;
  maybeSingle?: StubResult;
  insertReturn?: StubResult;
  updateReturn?: StubResult;
  deleteReturn?: StubResult;
}): QueryStub {
  const stub: Partial<QueryStub> = {};
  stub.select = jest.fn().mockReturnValue(stub);
  stub.insert = jest.fn().mockReturnValue({
    select: jest.fn().mockReturnValue({
      single: jest.fn().mockResolvedValue(handlers.insertReturn ?? handlers.single ?? { data: null, error: null }),
    }),
    then: (resolve: (value: StubResult) => unknown) =>
      resolve(handlers.insertReturn ?? { data: null, error: null }),
  });
  stub.update = jest.fn().mockReturnValue({
    eq: jest.fn().mockResolvedValue(handlers.updateReturn ?? { data: null, error: null }),
  });
  stub.delete = jest.fn().mockReturnValue({
    eq: jest.fn().mockResolvedValue(handlers.deleteReturn ?? { data: null, error: null }),
  });
  stub.eq = jest.fn().mockReturnValue(stub);
  stub.in = jest.fn().mockReturnValue(stub);
  stub.single = jest.fn().mockResolvedValue(handlers.single ?? { data: null, error: null });
  stub.maybeSingle = jest.fn().mockResolvedValue(handlers.maybeSingle ?? handlers.single ?? { data: null, error: null });
  stub.then = (resolve) => resolve(handlers.list ?? { data: [], error: null });
  return stub as QueryStub;
}

describe('RulesNewService', () => {
  let service: RulesNewService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RulesNewService,
        {
          provide: SupabaseService,
          useValue: {
            getClient: () => null,
            getAdminClient: () => null,
          },
        },
      ],
    }).compile();

    service = module.get<RulesNewService>(RulesNewService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('findAll returns an empty list when the user cannot view any devices', async () => {
    const devicesQuery = buildQueryStub({
      list: { data: [], error: null },
    });
    const client = {
      from: jest.fn(() => devicesQuery),
    };

    const serviceWithClient = new RulesNewService(
      {
        getClient: jest.fn(() => client),
        getAdminClient: jest.fn(),
      } as unknown as SupabaseService,
      {} as any,
      {} as any,
    );

    await expect(
      serviceWithClient.findAll(
        { sub: 'user-1', email: 'user@example.com' },
        'Bearer token-1',
      ),
    ).resolves.toEqual([]);

    expect(client.from).toHaveBeenCalledWith('cw_devices');
  });

  it('create rejects devices the caller cannot manage', async () => {
    const devicesQuery = buildQueryStub({
      list: {
        data: [
          {
            dev_eui: 'AA',
            name: 'Device A',
            user_id: 'someone-else',
            cw_device_owners: [
              { user_id: 'user-1', permission_level: 4 },
            ],
          },
        ],
        error: null,
      },
    });

    const client = {
      from: jest.fn(() => devicesQuery),
    };

    const serviceWithClient = new RulesNewService(
      {
        getClient: jest.fn(() => client),
        getAdminClient: jest.fn(),
      } as unknown as SupabaseService,
      {} as any,
      {} as any,
    );

    await expect(
      serviceWithClient.create(
        {
          name: 'Hot greenhouse',
          devEuis: ['AA'],
          criteria: [
            {
              subject: 'temperature_c',
              operator: '>',
              triggerValue: 30,
              resetValue: 25,
            },
          ],
          actions: [
            {
              actionType: 1,
              config: { recipient: 'me@example.com' },
            },
          ],
        },
        { sub: 'user-1', email: 'user@example.com' },
        'Bearer token-1',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('findOne throws NotFound when no assignment is visible to the user', async () => {
    const devicesQuery = buildQueryStub({
      list: {
        data: [
          {
            dev_eui: 'AA',
            name: 'Device A',
            user_id: 'user-1',
            cw_device_owners: [],
          },
        ],
        error: null,
      },
    });
    const templateQuery = buildQueryStub({
      maybeSingle: {
        data: {
          id: 1,
          name: 'Template',
          description: null,
          device_type_id: null,
          is_active: true,
          created_at: null,
        },
        error: null,
      },
    });
    const assignmentsQuery = buildQueryStub({
      list: { data: [], error: null },
    });

    const fromMock = jest
      .fn()
      .mockImplementationOnce(() => devicesQuery)
      .mockImplementationOnce(() => templateQuery)
      .mockImplementationOnce(() => assignmentsQuery);

    const serviceWithClient = new RulesNewService(
      {
        getClient: jest.fn(() => ({ from: fromMock })),
        getAdminClient: jest.fn(),
      } as unknown as SupabaseService,
      {} as any,
      {} as any,
    );

    await expect(
      serviceWithClient.findOne(
        1,
        { sub: 'user-1', email: 'user@example.com' },
        'Bearer token-1',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
