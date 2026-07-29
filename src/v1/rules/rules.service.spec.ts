import {
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { SupabaseService } from '../../supabase/supabase.service';
import { DevicesService } from '../devices/devices.service';
import { LocationsService } from '../locations/locations.service';
import { RulesService } from './rules.service';

type StubResult = { data: unknown; error: unknown };

interface FilterCall {
  method: string;
  args: unknown[];
}

interface WriteCall {
  payload?: unknown;
  filters: FilterCall[];
}

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
  updateCalls: WriteCall[];
  deleteCalls: WriteCall[];
}

// update()/delete() return a chainable thenable that records its filters, so
// tests can assert the exact WHERE clause a write was issued with.
function buildWriteChain(result: StubResult, call: WriteCall) {
  const chain: Record<string, unknown> = {};
  for (const method of ['eq', 'in', 'is', 'not']) {
    chain[method] = jest.fn((...args: unknown[]) => {
      call.filters.push({ method, args });
      return chain;
    });
  }
  chain.then = (resolve: (value: StubResult) => unknown) => resolve(result);
  return chain;
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
      single: jest
        .fn()
        .mockResolvedValue(
          handlers.insertReturn ??
            handlers.single ?? { data: null, error: null },
        ),
    }),
    then: (resolve: (value: StubResult) => unknown) =>
      resolve(handlers.insertReturn ?? { data: null, error: null }),
  });
  stub.updateCalls = [];
  stub.update = jest.fn((payload: unknown) => {
    const call: WriteCall = { payload, filters: [] };
    stub.updateCalls!.push(call);
    return buildWriteChain(
      handlers.updateReturn ?? { data: null, error: null },
      call,
    );
  });
  stub.deleteCalls = [];
  stub.delete = jest.fn(() => {
    const call: WriteCall = { filters: [] };
    stub.deleteCalls!.push(call);
    return buildWriteChain(
      handlers.deleteReturn ?? { data: null, error: null },
      call,
    );
  });
  stub.eq = jest.fn().mockReturnValue(stub);
  stub.in = jest.fn().mockReturnValue(stub);
  stub.single = jest
    .fn()
    .mockResolvedValue(handlers.single ?? { data: null, error: null });
  stub.maybeSingle = jest
    .fn()
    .mockResolvedValue(
      handlers.maybeSingle ?? handlers.single ?? { data: null, error: null },
    );
  stub.then = (resolve) => resolve(handlers.list ?? { data: [], error: null });
  return stub as QueryStub;
}

// Routes from(table) to per-table stubs so tests only depend on same-table
// call order, not the service's global .from() sequence. A single stub for a
// table serves every call; an array is consumed in order, last stub repeating.
function buildClient(stubsByTable: Record<string, QueryStub | QueryStub[]>) {
  const queues = new Map<string, QueryStub[]>();
  for (const [table, stubs] of Object.entries(stubsByTable)) {
    queues.set(table, Array.isArray(stubs) ? [...stubs] : [stubs]);
  }
  const from = jest.fn((table: string) => {
    const queue = queues.get(table);
    if (!queue || queue.length === 0) {
      throw new Error(`Unexpected from('${table}') call in test`);
    }
    return queue.length > 1 ? queue.shift()! : queue[0];
  });
  return { from };
}

function serviceWith(client: { from: jest.Mock }): RulesService {
  return new RulesService(
    {
      getClient: jest.fn(() => client),
      getAdminClient: jest.fn(),
    } as unknown as SupabaseService,
    {} as unknown as DevicesService,
    {} as unknown as LocationsService,
  );
}

describe('RulesService', () => {
  let service: RulesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RulesService,
        {
          provide: SupabaseService,
          useValue: {
            getClient: () => null,
            getAdminClient: () => null,
          },
        },
        {
          provide: DevicesService,
          useValue: {},
        },
        {
          provide: LocationsService,
          useValue: {},
        },
      ],
    }).compile();

    service = module.get<RulesService>(RulesService);
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

    const serviceWithClient = new RulesService(
      {
        getClient: jest.fn(() => client),
        getAdminClient: jest.fn(),
      } as unknown as SupabaseService,
      {} as unknown as DevicesService,
      {} as unknown as LocationsService,
    );

    await expect(
      serviceWithClient.findAll({
        sub: 'user-1',
        email: 'user@example.com',
        isStaff: false,
      }),
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
            cw_device_owners: [{ user_id: 'user-1', permission_level: 4 }],
          },
        ],
        error: null,
      },
    });

    const client = {
      from: jest.fn(() => devicesQuery),
    };

    const serviceWithClient = new RulesService(
      {
        getClient: jest.fn(() => client),
        getAdminClient: jest.fn(),
      } as unknown as SupabaseService,
      {} as unknown as DevicesService,
      {} as unknown as LocationsService,
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
        { sub: 'user-1', email: 'user@example.com', isStaff: false },
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

    const serviceWithClient = new RulesService(
      {
        getClient: jest.fn(() => ({ from: fromMock })),
        getAdminClient: jest.fn(),
      } as unknown as SupabaseService,
      {} as unknown as DevicesService,
      {} as unknown as LocationsService,
    );

    await expect(
      serviceWithClient.findOne(1, {
        sub: 'user-1',
        email: 'user@example.com',
        isStaff: false,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  describe('triggered rules', () => {
    const jwt = { sub: 'user-1', email: 'user@example.com', isStaff: false };

    const buildRule = (
      id: number,
      assignments: Array<{ devEui: string; isTriggered: boolean | null }>,
    ) => ({
      id,
      name: `Rule ${id}`,
      description: null,
      deviceTypeId: null,
      isActive: true,
      createdAt: null,
      criteria: [],
      actions: [],
      assignments: assignments.map((entry, index) => ({
        id: id * 10 + index,
        devEui: entry.devEui,
        templateId: id,
        isActive: true,
        createdAt: null,
        deviceName: null,
        locationName: null,
        permissionLevel: 2,
        state:
          entry.isTriggered === null
            ? null
            : {
                id: id * 100 + index,
                devEui: entry.devEui,
                templateId: id,
                isTriggered: entry.isTriggered,
                lastTriggeredAt: null,
                lastResetAt: null,
              },
      })),
    });

    it('findAllTriggered returns only templates with triggered assignments, narrowed to those assignments', async () => {
      const service = new RulesService(
        {} as unknown as SupabaseService,
        {} as unknown as DevicesService,
        {} as unknown as LocationsService,
      );
      jest.spyOn(service, 'findAll').mockResolvedValue([
        buildRule(1, [
          { devEui: 'AA', isTriggered: true },
          { devEui: 'BB', isTriggered: false },
        ]),
        buildRule(2, [{ devEui: 'CC', isTriggered: false }]),
        buildRule(3, [{ devEui: 'DD', isTriggered: null }]),
      ]);

      const triggered = await service.findAllTriggered(jwt);

      expect(triggered).toHaveLength(1);
      expect(triggered[0].id).toBe(1);
      expect(triggered[0].assignments).toHaveLength(1);
      expect(triggered[0].assignments[0].devEui).toBe('AA');
    });

    it('findTriggeredCount reports triggered and total counts', async () => {
      const service = new RulesService(
        {} as unknown as SupabaseService,
        {} as unknown as DevicesService,
        {} as unknown as LocationsService,
      );
      jest
        .spyOn(service, 'findAll')
        .mockResolvedValue([
          buildRule(1, [{ devEui: 'AA', isTriggered: true }]),
          buildRule(2, [{ devEui: 'BB', isTriggered: false }]),
        ]);

      await expect(service.findTriggeredCount(jwt)).resolves.toEqual({
        count: 1,
        triggered_count: 1,
        total_count: 2,
      });
    });
  });

  describe('update and remove state handling', () => {
    const jwt = { sub: 'user-1', email: 'user@example.com', isStaff: false };

    const deviceRows = (devEuis: string[]) =>
      devEuis.map((devEui) => ({
        dev_eui: devEui,
        name: `Device ${devEui}`,
        user_id: 'user-1',
        cw_device_owners: [],
      }));

    const templateRow = {
      id: 1,
      name: 'Freezer temp',
      description: null,
      device_type_id: null,
      is_active: true,
      created_at: null,
    };

    const assignmentRows = (devEuis: string[]) =>
      devEuis.map((devEui, index) => ({
        id: index + 1,
        dev_eui: devEui,
        template_id: 1,
        is_active: true,
        created_at: null,
      }));

    const savePayload = (devEuis: string[]) => ({
      name: 'Freezer temp',
      devEuis,
      criteria: [
        {
          subject: 'temperature_c',
          operator: '>=',
          triggerValue: -15,
          resetValue: -18,
        },
      ],
      actions: [{ actionType: 1, config: { recipient: 'me@example.com' } }],
    });

    interface UpdateStubs {
      state: QueryStub;
      triggerLog: QueryStub;
      templates: QueryStub;
    }

    const buildUpdateClient = (
      existingDevEuis: string[],
      overrides?: Partial<
        Record<'stateHandlers', { deleteReturn: StubResult }>
      >,
    ): { client: { from: jest.Mock }; stubs: UpdateStubs } => {
      const state = buildQueryStub({
        list: { data: [], error: null },
        ...(overrides?.stateHandlers ?? {}),
      });
      const triggerLog = buildQueryStub({});
      const templates = buildQueryStub({
        maybeSingle: { data: templateRow, error: null },
      });
      const client = buildClient({
        cw_devices: buildQueryStub({
          list: { data: deviceRows(existingDevEuis), error: null },
        }),
        cw_rule_templates: templates,
        cw_device_rule_assignments: buildQueryStub({
          list: { data: assignmentRows(existingDevEuis), error: null },
        }),
        cw_rule_template_criteria: buildQueryStub({}),
        cw_rule_template_actions: buildQueryStub({}),
        cw_rule_state: state,
        cw_rule_trigger_log: triggerLog,
      });
      return { client, stubs: { state, triggerLog, templates } };
    };

    it('update preserves state for still-assigned devices (never a template-wide wipe)', async () => {
      const { client, stubs } = buildUpdateClient(['AA', 'BB']);
      const service = serviceWith(client);

      await service.update(1, savePayload(['AA']), jwt);

      expect(stubs.state.deleteCalls).toHaveLength(1);
      const filters = stubs.state.deleteCalls[0].filters;
      expect(filters).toContainEqual({
        method: 'eq',
        args: ['template_id', 1],
      });
      expect(filters).toContainEqual({
        method: 'not',
        args: ['dev_eui', 'in', '("AA")'],
      });
    });

    it('update closes open trigger-log rows only for removed devices', async () => {
      const { client, stubs } = buildUpdateClient(['AA', 'BB']);
      const service = serviceWith(client);

      await service.update(1, savePayload(['AA']), jwt);

      expect(stubs.triggerLog.updateCalls).toHaveLength(1);
      const call = stubs.triggerLog.updateCalls[0];
      const payload = call.payload as { reset_at: unknown };
      expect(Object.keys(payload)).toEqual(['reset_at']);
      expect(typeof payload.reset_at).toBe('string');
      expect(call.filters).toContainEqual({
        method: 'eq',
        args: ['template_id', 1],
      });
      expect(call.filters).toContainEqual({
        method: 'is',
        args: ['reset_at', null],
      });
      expect(call.filters).toContainEqual({
        method: 'not',
        args: ['dev_eui', 'in', '("AA")'],
      });
    });

    it('update happy path returns the re-fetched template', async () => {
      const { client } = buildUpdateClient(['AA']);
      const service = serviceWith(client);

      const result = await service.update(1, savePayload(['AA']), jwt);

      expect(result.id).toBe(1);
      expect(result.name).toBe('Freezer temp');
    });

    it('update surfaces InternalServerErrorException when state cleanup fails', async () => {
      const { client } = buildUpdateClient(['AA'], {
        stateHandlers: {
          deleteReturn: { data: null, error: { message: 'boom' } },
        },
      });
      const service = serviceWith(client);

      await expect(
        service.update(1, savePayload(['AA']), jwt),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
    });

    it('remove closes all open trigger-log rows and deletes state, children, template', async () => {
      const { client, stubs } = buildUpdateClient(['AA']);
      const service = serviceWith(client);

      await service.remove(1, jwt);

      expect(stubs.state.deleteCalls).toHaveLength(1);
      expect(stubs.state.deleteCalls[0].filters).toEqual([
        { method: 'eq', args: ['template_id', 1] },
      ]);

      expect(stubs.triggerLog.updateCalls).toHaveLength(1);
      const logCall = stubs.triggerLog.updateCalls[0];
      const logPayload = logCall.payload as { reset_at: unknown };
      expect(Object.keys(logPayload)).toEqual(['reset_at']);
      expect(typeof logPayload.reset_at).toBe('string');
      expect(logCall.filters).toEqual([
        { method: 'eq', args: ['template_id', 1] },
        { method: 'is', args: ['reset_at', null] },
      ]);

      expect(stubs.templates.deleteCalls).toHaveLength(1);
      expect(stubs.templates.deleteCalls[0].filters).toContainEqual({
        method: 'eq',
        args: ['id', 1],
      });
    });
  });
});
