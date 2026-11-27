import {
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import { AccessService, type AccessibleDevice } from '../common/authz';
import { DevicesService } from '../devices/devices.service';
import { LocationsService } from '../locations/locations.service';
import { RulesService } from './rules.service';

// ---------------------------------------------------------------------------
// A small in-memory stand-in for the Supabase client: selects answer from the
// tables below with their eq/in filters applied, writes are recorded in order.
// ---------------------------------------------------------------------------
type Row = Record<string, unknown>;
type Result = { data: unknown; error: unknown };

interface Filter {
  method: string;
  args: unknown[];
}

interface Call {
  table: string;
  op: 'select' | 'insert' | 'update' | 'delete';
  payload?: unknown;
  filters: Filter[];
}

interface World {
  tables: Record<string, Row[]>;
  /** Everything that changed something, in the order it happened. */
  log: string[];
  calls: Call[];
  rpc: jest.Mock;
  /** Table -> error to answer every select on it with. */
  selectErrors: Record<string, unknown>;
  /** Fails the selects it returns true for (to hit one query among several). */
  failSelect: ((call: Call) => boolean) | null;
  /** What cw_rule_switch answers; the default really flips is_active. */
  switchResult: Result | null;
}

function applyFilters(rows: Row[], filters: Filter[]): Row[] {
  return rows.filter((row) =>
    filters.every(({ method, args }) => {
      const [column, value] = args as [string, unknown];
      if (method === 'eq') return row[column] === value;
      if (method === 'in') return (value as unknown[]).includes(row[column]);
      return true;
    }),
  );
}

function buildWorld(tables: Record<string, Row[]>): {
  world: World;
  client: { from: jest.Mock; rpc: jest.Mock };
} {
  const world: World = {
    tables: {
      cw_rule_template_criteria: [],
      cw_rule_template_actions: [],
      cw_rule_state: [],
      cw_rule_trigger_log: [],
      profiles: [],
      ...tables,
    },
    log: [],
    calls: [],
    rpc: jest.fn(),
    selectErrors: {},
    failSelect: null,
    switchResult: null,
  };

  world.rpc.mockImplementation(
    (name: string, args: { p_template_id: number; p_activate: boolean }) => {
      world.log.push(`rpc:${name}:${args.p_activate ? 'start' : 'pause'}`);
      if (world.switchResult) return Promise.resolve(world.switchResult);
      const template = world.tables.cw_rule_templates.find(
        (row) => row.id === args.p_template_id,
      );
      if (!template) return Promise.resolve({ data: 'not_found', error: null });
      const current = template.is_active ?? true;
      if (current === args.p_activate) {
        return Promise.resolve({ data: 'noop', error: null });
      }
      template.is_active = args.p_activate;
      return Promise.resolve({ data: 'changed', error: null });
    },
  );

  const from = jest.fn((table: string) => {
    const call: Call = { table, op: 'select', filters: [] };
    const answer = (): Result => {
      world.calls.push(call);
      if (call.op !== 'select') {
        world.log.push(`${call.op}:${table}`);
        if (call.op === 'insert' && table === 'cw_rule_templates') {
          const row = { id: 900, ...(call.payload as Row) };
          world.tables.cw_rule_templates.push(row);
          return { data: row, error: null };
        }
        if (call.op === 'insert' && table === 'cw_device_rule_assignments') {
          world.tables[table].push(...(call.payload as Row[]));
        }
        if (call.op === 'update' && table === 'cw_rule_templates') {
          for (const row of applyFilters(world.tables[table], call.filters)) {
            Object.assign(row, call.payload);
          }
        }
        if (call.op === 'delete' && table === 'cw_device_rule_assignments') {
          const gone = new Set(applyFilters(world.tables[table], call.filters));
          world.tables[table] = world.tables[table].filter(
            (row) => !gone.has(row),
          );
        }
        return { data: null, error: null };
      }
      if (world.selectErrors[table]) {
        return { data: null, error: world.selectErrors[table] };
      }
      if (world.failSelect?.(call)) {
        return { data: null, error: { message: 'boom' } };
      }
      if (!world.tables[table]) {
        throw new Error(`Unexpected from('${table}') call in test`);
      }
      const rows = applyFilters(world.tables[table], call.filters).map((row) =>
        table === 'cw_device_rule_assignments'
          ? {
              ...row,
              // The cw_devices(org_id) embed of listRuleOptions.
              cw_devices: world.tables.cw_devices?.find(
                (device) => device.dev_eui === row.dev_eui,
              ),
            }
          : row,
      );
      return { data: rows, error: null };
    };

    const builder: Record<string, unknown> = {};
    for (const method of ['eq', 'in', 'is', 'not', 'order', 'limit']) {
      builder[method] = (...args: unknown[]) => {
        call.filters.push({ method, args });
        return builder;
      };
    }
    builder.select = () => builder;
    for (const op of ['insert', 'update', 'delete'] as const) {
      builder[op] = (payload?: unknown) => {
        call.op = op;
        call.payload = payload;
        return builder;
      };
    }
    const one = () => {
      const result = answer();
      const rows = result.data;
      return Promise.resolve(
        Array.isArray(rows)
          ? { ...result, data: (rows as Row[])[0] ?? null }
          : result,
      );
    };
    builder.single = one;
    builder.maybeSingle = one;
    builder.then = (
      resolve: (value: Result) => unknown,
      reject: (reason: unknown) => unknown,
    ) => {
      try {
        return Promise.resolve(answer()).then(resolve, reject);
      } catch (error) {
        return Promise.reject(error as Error).then(resolve, reject);
      }
    };
    return builder;
  });

  return { world, client: { from, rpc: world.rpc } };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const ORG_A = 'org-a';
const ORG_B = 'org-b';
const customer = { sub: 'user-1', email: 'aki@example.com', isStaff: false };
const staff = { sub: 'staff-1', email: 'kevin@cropwatch.io', isStaff: true };

const NOW = Date.parse('2026-11-27T03:00:00Z');
const PAST = '2026-11-27T02:00:00.000Z';
const SOON = '2026-11-28T00:00:00.000Z';
const LATER = '2026-12-24T00:00:00.000Z';

const template = (id: number, name: string, overrides: Row = {}): Row => ({
  id,
  name,
  description: null,
  device_type_id: null,
  is_active: true,
  created_at: '2026-11-01T00:00:00+00:00',
  auto_start_at: null,
  auto_pause_at: null,
  on_auto_pause_start_template_id: null,
  status_changed_at: null,
  status_reason: null,
  status_changed_by_user: null,
  status_changed_by_template: null,
  ...overrides,
});

let nextAssignmentId = 1;
const assign = (templateId: number, ...devEuis: string[]): Row[] =>
  devEuis.map((devEui) => ({
    id: nextAssignmentId++,
    dev_eui: devEui,
    template_id: templateId,
    is_active: true,
    created_at: null,
  }));

const device = (devEui: string, orgId: string | null): Row => ({
  dev_eui: devEui,
  org_id: orgId,
});

/** What the caller may do with each device; a device left out is invisible. */
function access(
  devices: Record<string, 'manage' | 'view'>,
): AccessibleDevice[] {
  return Object.entries(devices).map(([devEui, level]) => ({
    devEui,
    orgId: ORG_A,
    groupId: null,
    name: `Device ${devEui}`,
    permissionLevel: level === 'manage' ? 1 : 3,
    canView: true,
    canManage: level === 'manage',
    canWriteNotes: level === 'manage',
  }));
}

function buildService(
  tables: Record<string, Row[]>,
  devices: AccessibleDevice[],
) {
  const { world, client } = buildWorld(tables);
  const accessService = {
    listAccessibleDevices: jest.fn().mockResolvedValue(devices),
    assertDevicesManageable: jest.fn((_user: unknown, devEuis: string[]) => {
      const manageable = new Set(
        devices.filter((d) => d.canManage).map((d) => d.devEui),
      );
      return devEuis.every((devEui) => manageable.has(devEui))
        ? Promise.resolve()
        : Promise.reject(
            new ForbiddenException(
              'You do not have permission to manage one or more selected devices',
            ),
          );
    }),
  };
  const service = new RulesService(
    { getClient: () => client } as unknown as SupabaseService,
    {
      findAll: jest.fn().mockResolvedValue({ data: [] }),
    } as unknown as DevicesService,
    {
      findAll: jest.fn().mockResolvedValue([]),
    } as unknown as LocationsService,
    accessService as unknown as AccessService,
  );
  return { service, world, accessService };
}

const savePayload = (devEuis: string[], extra: Row = {}) => ({
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
  actions: [{ actionType: 2, config: { recipient: 'me@example.com' } }],
  ...extra,
});

const templateWrites = (world: World): Row[] =>
  world.calls
    .filter(
      (call) => call.table === 'cw_rule_templates' && call.op === 'update',
    )
    .map((call) => call.payload as Row);

describe('RulesService: start, pause and dates', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.setSystemTime(NOW);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  describe('status in the list and on one rule', () => {
    it('a rule that never changed is running since it was created', async () => {
      const { service } = buildService(
        {
          cw_rule_templates: [template(1, 'Freezer')],
          cw_device_rule_assignments: assign(1, 'AA'),
        },
        access({ AA: 'manage' }),
      );

      const [rule] = await service.findAll(customer);

      expect(rule).toMatchObject({
        isActive: true,
        autoStartAt: null,
        autoPauseAt: null,
        onAutoPauseStartTemplateId: null,
        status: {
          state: 'running',
          since: '2026-11-01T00:00:00+00:00',
          reason: null,
          byUserName: null,
          nextStart: null,
        },
      });
    });

    it('shows who paused a rule, but never a staff member to a customer', async () => {
      const tables = {
        cw_rule_templates: [
          template(1, 'By a colleague', {
            is_active: false,
            status_changed_at: '2026-11-20T09:00:00+00:00',
            status_reason: 'manual',
            status_changed_by_user: 'user-2',
          }),
          template(2, 'By staff', {
            is_active: false,
            status_reason: 'manual',
            status_changed_by_user: 'staff-1',
          }),
          template(3, 'By someone without a name', {
            is_active: false,
            status_reason: 'manual',
            status_changed_by_user: 'user-3',
          }),
        ],
        cw_device_rule_assignments: [
          ...assign(1, 'AA'),
          ...assign(2, 'AA'),
          ...assign(3, 'AA'),
        ],
        profiles: [
          {
            id: 'user-2',
            email: 'mei@example.com',
            full_name: ' Mei ',
            username: 'mei',
          },
          {
            id: 'staff-1',
            email: 'kevin@cropwatch.io',
            full_name: 'Kevin',
            username: null,
          },
          {
            id: 'user-3',
            email: 'x@example.com',
            full_name: ' ',
            username: null,
          },
        ],
      };

      const forCustomer = await buildService(
        tables,
        access({ AA: 'view' }),
      ).service.findAll(customer);
      const forStaff = await buildService(
        tables,
        access({ AA: 'manage' }),
      ).service.findAll(staff);

      const names = (rules: Awaited<ReturnType<RulesService['findAll']>>) =>
        Object.fromEntries(
          rules.map((rule) => [rule.id, rule.status.byUserName]),
        );
      expect(names(forCustomer)).toEqual({ 1: 'Mei', 2: null, 3: null });
      expect(names(forStaff)).toEqual({ 1: 'Mei', 2: 'Kevin', 3: null });
      expect(forCustomer[0].status).toMatchObject({
        state: 'paused',
        reason: 'manual',
        since: '2026-11-20T09:00:00+00:00',
      });
    });

    it('a paused rule with a start date, or one another rule will start, is scheduled', async () => {
      const { service } = buildService(
        {
          cw_rule_templates: [
            template(1, 'Starts on a date', {
              is_active: false,
              auto_start_at: SOON,
            }),
            template(2, 'Summer', {
              auto_pause_at: LATER,
              on_auto_pause_start_template_id: 3,
            }),
            template(3, 'Winter', { is_active: false }),
            // A takeover without a pause date never happens.
            template(4, 'Broken link', { on_auto_pause_start_template_id: 5 }),
            template(5, 'Stays paused', { is_active: false }),
          ],
          cw_device_rule_assignments: [1, 2, 3, 4, 5].flatMap((id) =>
            assign(id, 'AA'),
          ),
        },
        access({ AA: 'manage' }),
      );

      const rules = await service.findAll(customer);
      const status = Object.fromEntries(
        rules.map((rule) => [rule.id, rule.status]),
      );

      expect(status[1]).toMatchObject({
        state: 'scheduled',
        nextStart: { at: SOON, source: 'date', byRule: null },
      });
      expect(status[2]).toMatchObject({
        state: 'running',
        autoPauseAt: LATER,
        thenStart: { id: 3, name: 'Winter' },
      });
      expect(status[3]).toMatchObject({
        state: 'scheduled',
        nextStart: {
          at: LATER,
          source: 'chain',
          byRule: { id: 2, name: 'Summer' },
        },
      });
      expect(status[5]).toMatchObject({ state: 'paused', nextStart: null });
    });

    it('names another rule only when the caller can see that rule', async () => {
      const tables = {
        cw_rule_templates: [
          template(1, 'Mine', {
            is_active: false,
            status_reason: 'rule_action',
            status_changed_by_template: 2,
          }),
          template(2, 'Shared switch'),
          template(3, 'Their takeover', {
            auto_pause_at: LATER,
            on_auto_pause_start_template_id: 1,
          }),
        ],
        cw_device_rule_assignments: [
          ...assign(1, 'AA'),
          ...assign(2, 'BB'),
          ...assign(3, 'CC'),
        ],
      };

      const seesTwo = await buildService(
        tables,
        access({ AA: 'manage', BB: 'view' }),
      ).service.findOne(1, customer);
      const seesAll = await buildService(
        tables,
        access({ AA: 'manage', BB: 'view', CC: 'view' }),
      ).service.findOne(1, customer);

      expect(seesTwo.status.byRule).toEqual({ id: 2, name: 'Shared switch' });
      // Still scheduled, by a rule it cannot name.
      expect(seesTwo.status.nextStart).toEqual({
        at: LATER,
        source: 'chain',
        byRule: { id: 3, name: null },
      });
      expect(seesAll.status.nextStart?.byRule).toEqual({
        id: 3,
        name: 'Their takeover',
      });
    });

    it.each(['profiles', 'cw_rule_templates'])(
      'fails loudly when %s cannot be read for the status',
      async (table) => {
        const { service, world } = buildService(
          {
            cw_rule_templates: [
              template(1, 'Freezer', { status_changed_by_user: 'user-2' }),
            ],
            cw_device_rule_assignments: assign(1, 'AA'),
          },
          access({ AA: 'manage' }),
        );
        world.selectErrors[table] = { message: 'boom' };

        await expect(service.findAll(customer)).rejects.toBeInstanceOf(
          InternalServerErrorException,
        );
      },
    );
  });

  describe('setRunning (Start and Pause buttons)', () => {
    const tables = () => ({
      cw_rule_templates: [template(1, 'Freezer')],
      cw_device_rule_assignments: assign(1, 'AA', 'BB'),
    });

    it('pauses through cw_rule_switch and rewrites nothing else', async () => {
      const { service, world } = buildService(
        tables(),
        access({ AA: 'manage', BB: 'manage' }),
      );

      const rule = await service.setRunning(1, false, customer);

      expect(world.rpc).toHaveBeenCalledTimes(1);
      expect(world.rpc).toHaveBeenCalledWith('cw_rule_switch', {
        p_template_id: 1,
        p_activate: false,
        p_reason: 'manual',
        p_by_user: 'user-1',
      });
      // No insert, update or delete: the rule's actions keep their ids.
      expect(world.log).toEqual(['rpc:cw_rule_switch:pause']);
      expect(rule.isActive).toBe(false);
      expect(rule.status.state).toBe('paused');
    });

    it('starts a paused rule', async () => {
      const { service, world } = buildService(
        {
          ...tables(),
          cw_rule_templates: [template(1, 'Freezer', { is_active: false })],
        },
        access({ AA: 'manage', BB: 'manage' }),
      );

      const rule = await service.setRunning(1, true, customer);

      expect(world.log).toEqual(['rpc:cw_rule_switch:start']);
      expect(rule.isActive).toBe(true);
    });

    it('is fine when the rule already is in that state', async () => {
      const { service, world } = buildService(
        tables(),
        access({ AA: 'manage', BB: 'manage' }),
      );

      await expect(
        service.setRunning(1, true, customer),
      ).resolves.toMatchObject({ id: 1, isActive: true });
      expect(world.log).toEqual(['rpc:cw_rule_switch:start']);
    });

    it('answers 404 for a rule the caller cannot see', async () => {
      const { service, world } = buildService(
        tables(),
        access({ ZZ: 'manage' }),
      );

      await expect(
        service.setRunning(1, false, customer),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(world.rpc).not.toHaveBeenCalled();
    });

    it.each([
      [
        'a device the caller can only view',
        access({ AA: 'manage', BB: 'view' }),
      ],
      ['a device the caller cannot see at all', access({ AA: 'manage' })],
    ])('refuses when the rule also covers %s', async (_name, devices) => {
      const { service, world, accessService } = buildService(tables(), devices);

      await expect(
        service.setRunning(1, false, customer),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(accessService.assertDevicesManageable).toHaveBeenCalledWith(
        customer,
        ['AA', 'BB'],
      );
      expect(world.rpc).not.toHaveBeenCalled();
    });

    it.each([
      ['an RPC error', { data: null, error: { message: 'boom' } }, 500],
      [
        'an outcome a manual switch never has',
        { data: 'forbidden', error: null },
        500,
      ],
      ['a rule deleted meanwhile', { data: 'not_found', error: null }, 404],
    ])('maps %s', async (_name, result, status) => {
      const { service, world } = buildService(
        tables(),
        access({ AA: 'manage', BB: 'manage' }),
      );
      world.switchResult = result;

      await expect(
        service.setRunning(1, false, customer),
      ).rejects.toBeInstanceOf(
        status === 404 ? NotFoundException : InternalServerErrorException,
      );
    });

    it('says which direction failed', async () => {
      const { service, world } = buildService(
        tables(),
        access({ AA: 'manage', BB: 'manage' }),
      );
      world.switchResult = { data: null, error: { message: 'boom' } };

      await expect(service.setRunning(1, true, customer)).rejects.toThrow(
        'Failed to start the rule',
      );
      await expect(service.setRunning(1, false, customer)).rejects.toThrow(
        'Failed to pause the rule',
      );
    });
  });

  describe('update', () => {
    const tables = (overrides: Row = {}) => ({
      cw_rule_templates: [template(1, 'Freezer temp', overrides)],
      cw_device_rule_assignments: assign(1, 'AA'),
      cw_devices: [device('AA', ORG_A)],
    });
    const manageAA = () => access({ AA: 'manage' });

    it('a save that does not mention the status leaves it alone', async () => {
      const { service, world } = buildService(
        tables({ is_active: false }),
        manageAA(),
      );

      const rule = await service.update(1, savePayload(['AA']), customer);

      expect(world.rpc).not.toHaveBeenCalled();
      // is_active is never written by the save itself.
      expect(templateWrites(world)).toEqual([
        { name: 'Freezer temp', description: null, device_type_id: null },
      ]);
      expect(rule.isActive).toBe(false);
    });

    it('a save with the status it already has does not switch', async () => {
      const { service, world } = buildService(tables(), manageAA());

      await service.update(
        1,
        savePayload(['AA'], { isActive: true }),
        customer,
      );

      expect(world.rpc).not.toHaveBeenCalled();
    });

    it('pauses before anything is rewritten', async () => {
      const { service, world } = buildService(tables(), manageAA());

      const rule = await service.update(
        1,
        savePayload(['AA'], { isActive: false }),
        customer,
      );

      expect(world.log[0]).toBe('rpc:cw_rule_switch:pause');
      expect(world.log.indexOf('update:cw_rule_templates')).toBeGreaterThan(0);
      expect(world.rpc).toHaveBeenCalledWith('cw_rule_switch', {
        p_template_id: 1,
        p_activate: false,
        p_reason: 'manual',
        p_by_user: 'user-1',
      });
      expect(templateWrites(world)[0]).not.toHaveProperty('is_active');
      expect(rule.isActive).toBe(false);
    });

    it('starts only after the rule has been saved completely', async () => {
      const { service, world } = buildService(
        tables({ is_active: false }),
        manageAA(),
      );

      const rule = await service.update(
        1,
        savePayload(['AA'], { isActive: true }),
        customer,
      );

      expect(world.log.at(-1)).toBe('rpc:cw_rule_switch:start');
      expect(world.log).toContain('insert:cw_rule_template_actions');
      expect(rule.isActive).toBe(true);
    });

    it('does not start a rule whose save failed', async () => {
      const { service, world } = buildService(
        tables({ is_active: false }),
        manageAA(),
      );
      jest
        .spyOn(
          service as unknown as {
            replaceTemplateChildren: () => Promise<void>;
          },
          'replaceTemplateChildren',
        )
        .mockRejectedValue(new InternalServerErrorException('boom'));

      await expect(
        service.update(1, savePayload(['AA'], { isActive: true }), customer),
      ).rejects.toThrow('boom');
      expect(world.rpc).not.toHaveBeenCalled();
    });

    it('refuses to pause or schedule a rule that covers devices the caller cannot manage', async () => {
      const partial = () => ({
        ...tables(),
        cw_device_rule_assignments: assign(1, 'AA', 'HIDDEN'),
      });

      for (const extra of [{ isActive: false }, { autoPauseAt: LATER }]) {
        const { service, world } = buildService(partial(), manageAA());
        await expect(
          service.update(1, savePayload(['AA'], extra), customer),
        ).rejects.toBeInstanceOf(ForbiddenException);
        expect(world.log).toEqual([]);
      }
    });

    it('writes new dates in UTC and only the ones that changed', async () => {
      const { service, world } = buildService(
        tables({
          is_active: false,
          auto_start_at: '2026-11-28T00:00:00+00:00',
        }),
        manageAA(),
      );

      const rule = await service.update(
        1,
        savePayload(['AA'], {
          autoStartAt: '2026-11-28T09:00:00+09:00',
          autoPauseAt: '2026-12-24T09:00:00+09:00',
        }),
        customer,
      );

      expect(templateWrites(world)).toEqual([
        {
          name: 'Freezer temp',
          description: null,
          device_type_id: null,
          auto_pause_at: LATER,
        },
      ]);
      expect(rule.autoPauseAt).toBe(LATER);
      expect(rule.status.state).toBe('scheduled');
    });

    it('never writes back a date the scheduler may have used up meanwhile', async () => {
      const { service, world } = buildService(
        tables({ auto_pause_at: PAST }),
        manageAA(),
      );

      await service.update(
        1,
        savePayload(['AA'], { autoPauseAt: PAST }),
        customer,
      );

      expect(templateWrites(world)[0]).not.toHaveProperty('auto_pause_at');
    });

    it('clears a date with null', async () => {
      const { service, world } = buildService(
        tables({ auto_start_at: SOON, auto_pause_at: LATER }),
        manageAA(),
      );

      await service.update(
        1,
        savePayload(['AA'], { autoStartAt: null }),
        customer,
      );

      expect(templateWrites(world)[0]).toMatchObject({ auto_start_at: null });
      expect(templateWrites(world)[0]).not.toHaveProperty('auto_pause_at');
    });

    it.each([
      [{ autoStartAt: PAST }, 'The start date must be in the future'],
      [{ autoPauseAt: PAST }, 'The pause date must be in the future'],
      [
        { autoStartAt: SOON, autoPauseAt: SOON },
        'The start date and the pause date cannot be the same',
      ],
      [
        { autoPauseAt: '2026-12-24T09:00:00' },
        'The pause date must be a date and time with a UTC offset',
      ],
      [
        { onAutoPauseStartTemplateId: 2 },
        'Choose a pause date before choosing the rule to start after it',
      ],
      [
        { autoPauseAt: LATER, onAutoPauseStartTemplateId: 1.5 },
        'The rule to start is not valid',
      ],
      [
        { autoPauseAt: LATER, onAutoPauseStartTemplateId: 1 },
        'A rule cannot start itself',
      ],
    ])('refuses %j', async (extra, message) => {
      const { service, world } = buildService(tables(), manageAA());

      await expect(
        service.update(1, savePayload(['AA'], extra), customer),
      ).rejects.toThrow(new BadRequestException(message));
      expect(world.log).toEqual([]);
    });
  });

  describe('the rule to start after the pause date', () => {
    const tables = (extra: Record<string, Row[]> = {}) => ({
      cw_rule_templates: [
        template(1, 'Summer'),
        template(2, 'Winter', { is_active: false }),
        template(3, 'Other organization', { is_active: false }),
        template(4, 'Two organizations', { is_active: false }),
        template(5, 'No devices', { is_active: false }),
      ],
      cw_device_rule_assignments: [
        ...assign(1, 'AA'),
        ...assign(2, 'A2'),
        ...assign(3, 'B1'),
        ...assign(4, 'A2', 'B1'),
      ],
      cw_devices: [
        device('AA', ORG_A),
        device('A2', ORG_A),
        device('B1', ORG_B),
        device('N1', null),
      ],
      ...extra,
    });
    const everything = () =>
      access({ AA: 'manage', A2: 'manage', B1: 'manage', N1: 'manage' });
    const chainTo = (id: number, devEuis = ['AA']) =>
      savePayload(devEuis, {
        autoPauseAt: LATER,
        onAutoPauseStartTemplateId: id,
      });

    it('is saved when both rules sit in the same organization', async () => {
      const { service, world } = buildService(tables(), everything());

      const rule = await service.update(1, chainTo(2), customer);

      expect(templateWrites(world)[0]).toMatchObject({
        auto_pause_at: LATER,
        on_auto_pause_start_template_id: 2,
      });
      expect(rule.onAutoPauseStartTemplateId).toBe(2);
      expect(rule.status.thenStart).toEqual({ id: 2, name: 'Winter' });
    });

    it.each([
      ['a rule of another organization', 3],
      ['a rule that spans two organizations', 4],
    ])('refuses %s', async (_name, targetId) => {
      const { service, world } = buildService(tables(), everything());

      await expect(
        service.update(1, chainTo(targetId), customer),
      ).rejects.toThrow(/same organization/);
      expect(world.log).toEqual([]);
    });

    it('refuses when this rule itself spans organizations or has a device without one', async () => {
      for (const devEuis of [
        ['AA', 'B1'],
        ['AA', 'N1'],
        ['AA', 'GONE'],
      ]) {
        const { service } = buildService(tables(), [
          ...everything(),
          ...access({ GONE: 'manage' }),
        ]);

        await expect(
          service.update(1, chainTo(2, devEuis), customer),
        ).rejects.toThrow(/same organization/);
      }
    });

    it.each([
      ['a rule that does not exist', 99, everything()],
      ['a rule without devices', 5, everything()],
      [
        'a rule the caller cannot manage in full',
        2,
        access({ AA: 'manage', A2: 'view' }),
      ],
      ['a rule the caller cannot see', 2, access({ AA: 'manage' })],
    ])('answers "not found" for %s', async (_name, targetId, devices) => {
      const { service, world } = buildService(tables(), devices);

      await expect(
        service.update(1, chainTo(targetId), customer),
      ).rejects.toThrow(
        new NotFoundException('The rule to start was not found'),
      );
      expect(world.log).toEqual([]);
    });

    it('is not checked again by a save that does not mention it', async () => {
      const { service } = buildService(
        {
          ...tables(),
          cw_rule_templates: [
            template(1, 'Summer', {
              auto_pause_at: LATER,
              on_auto_pause_start_template_id: 3,
            }),
            template(3, 'Other organization', { is_active: false }),
          ],
        },
        everything(),
      );

      // An older app version: it does not know the field, so it stays.
      const rule = await service.update(1, savePayload(['AA']), customer);

      expect(rule.onAutoPauseStartTemplateId).toBe(3);
    });

    it('goes away together with the pause date', async () => {
      const { service, world } = buildService(
        {
          ...tables(),
          cw_rule_templates: [
            template(1, 'Summer', {
              auto_pause_at: LATER,
              on_auto_pause_start_template_id: 2,
            }),
            template(2, 'Winter', { is_active: false }),
          ],
        },
        everything(),
      );

      await service.update(
        1,
        savePayload(['AA'], { autoPauseAt: null }),
        customer,
      );

      expect(templateWrites(world)[0]).toMatchObject({
        auto_pause_at: null,
        on_auto_pause_start_template_id: null,
      });
    });

    it('fails loudly when the devices cannot be read', async () => {
      const { service, world } = buildService(tables(), everything());
      world.selectErrors.cw_devices = { message: 'boom' };

      await expect(
        service.update(1, chainTo(2), customer),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
    });
  });

  describe('create', () => {
    const tables = () => ({
      cw_rule_templates: [template(2, 'Winter', { is_active: false })],
      cw_device_rule_assignments: assign(2, 'A2'),
      cw_devices: [device('AA', ORG_A), device('A2', ORG_A)],
    });
    const inserted = (world: World) =>
      world.calls.find(
        (call) => call.table === 'cw_rule_templates' && call.op === 'insert',
      )?.payload;

    it('a new rule runs unless it says otherwise', async () => {
      const { service, world } = buildService(
        tables(),
        access({ AA: 'manage', A2: 'manage' }),
      );

      const rule = await service.create(savePayload(['AA']), customer);

      expect(inserted(world)).toEqual({
        name: 'Freezer temp',
        description: null,
        device_type_id: null,
        is_active: true,
        auto_start_at: null,
        auto_pause_at: null,
        on_auto_pause_start_template_id: null,
      });
      expect(rule.status.state).toBe('running');
      expect(world.rpc).not.toHaveBeenCalled();
    });

    it('can be created paused, with dates and a rule to start', async () => {
      const { service, world } = buildService(
        tables(),
        access({ AA: 'manage', A2: 'manage' }),
      );

      const rule = await service.create(
        savePayload(['AA'], {
          isActive: false,
          autoStartAt: SOON,
          autoPauseAt: LATER,
          onAutoPauseStartTemplateId: 2,
        }),
        customer,
      );

      expect(inserted(world)).toMatchObject({
        is_active: false,
        auto_start_at: SOON,
        auto_pause_at: LATER,
        on_auto_pause_start_template_id: 2,
      });
      expect(rule.status).toMatchObject({
        state: 'scheduled',
        nextStart: { at: SOON, source: 'date' },
      });
    });

    it('checks the dates and the rule to start before anything is written', async () => {
      const { service, world } = buildService(
        tables(),
        access({ AA: 'manage' }),
      );

      await expect(
        service.create(savePayload(['AA'], { autoStartAt: PAST }), customer),
      ).rejects.toThrow('The start date must be in the future');
      await expect(
        service.create(
          savePayload(['AA'], {
            autoPauseAt: LATER,
            onAutoPauseStartTemplateId: 2,
          }),
          customer,
        ),
      ).rejects.toThrow('The rule to start was not found');
      expect(world.log).toEqual([]);
    });
  });

  describe('getFormContext', () => {
    it('offers the rules the caller manages in full, each inside one organization', async () => {
      const { service } = buildService(
        {
          cw_rule_templates: [
            template(1, 'This rule'),
            template(2, 'Winter'),
            template(3, 'Autumn'),
            template(4, 'Partly theirs'),
            template(5, 'Two organizations'),
            template(6, 'Only viewable'),
            template(7, 'Device without organization'),
          ],
          cw_device_rule_assignments: [
            ...assign(1, 'AA'),
            ...assign(2, 'AA'),
            ...assign(3, 'A2'),
            ...assign(4, 'AA', 'HIDDEN'),
            ...assign(5, 'AA', 'B1'),
            ...assign(6, 'VIEW'),
            ...assign(7, 'N1'),
          ],
          cw_devices: [
            device('AA', ORG_A),
            device('A2', ORG_A),
            device('B1', ORG_B),
            device('VIEW', ORG_A),
            device('HIDDEN', ORG_A),
            device('N1', null),
          ],
          cw_rule_action_types: [],
        },
        access({
          AA: 'manage',
          A2: 'manage',
          B1: 'manage',
          N1: 'manage',
          VIEW: 'view',
        }),
      );

      const context = await service.getFormContext(customer, 1);

      expect(context.ruleOptions).toEqual([
        { id: 3, name: 'Autumn' },
        { id: 2, name: 'Winter' },
      ]);
      expect(context.template?.id).toBe(1);
    });

    it('offers nothing to someone who manages no device', async () => {
      const { service } = buildService(
        {
          cw_rule_templates: [template(1, 'Freezer')],
          cw_device_rule_assignments: assign(1, 'AA'),
          cw_rule_action_types: [],
        },
        access({ AA: 'view' }),
      );

      await expect(service.getFormContext(customer)).resolves.toMatchObject({
        ruleOptions: [],
        template: null,
      });
    });

    it('offers nothing when no rule uses a device the caller manages', async () => {
      const { service } = buildService(
        {
          cw_rule_templates: [template(1, 'Freezer')],
          cw_device_rule_assignments: assign(1, 'AA'),
          cw_rule_action_types: [],
        },
        access({ ZZ: 'manage' }),
      );

      await expect(service.getFormContext(customer)).resolves.toMatchObject({
        ruleOptions: [],
      });
    });

    it.each(['cw_device_rule_assignments', 'cw_rule_templates'])(
      'fails loudly when %s cannot be read',
      async (table) => {
        const { service, world } = buildService(
          {
            cw_rule_templates: [template(1, 'Freezer')],
            cw_device_rule_assignments: assign(1, 'AA'),
            cw_devices: [device('AA', ORG_A)],
            cw_rule_action_types: [],
          },
          access({ AA: 'manage' }),
        );
        world.selectErrors[table] = { message: 'boom' };

        await expect(service.getFormContext(customer)).rejects.toBeInstanceOf(
          InternalServerErrorException,
        );
      },
    );
  });

  describe('lookups that fail', () => {
    const filtersOn = (call: Call, method: string) =>
      call.filters
        .filter((filter) => filter.method === method)
        .map((filter) => filter.args[0]);
    const tables = () => ({
      cw_rule_templates: [
        template(1, 'Summer', {
          auto_pause_at: LATER,
          on_auto_pause_start_template_id: 2,
        }),
        template(2, 'Winter', { is_active: false }),
      ],
      cw_device_rule_assignments: [...assign(1, 'AA'), ...assign(2, 'A2')],
      cw_devices: [device('AA', ORG_A), device('A2', ORG_A)],
      cw_rule_action_types: [],
    });
    const both = () => access({ AA: 'manage', A2: 'manage' });

    it('the rules that start a rule', async () => {
      const { service, world } = buildService(tables(), both());
      world.failSelect = (call) =>
        filtersOn(call, 'in').includes('on_auto_pause_start_template_id');

      await expect(service.findAll(customer)).rejects.toThrow(
        'Failed to load rule status',
      );
    });

    it.each([
      [
        'which of the rules referred to the caller can see',
        (call: Call) =>
          call.table === 'cw_device_rule_assignments' &&
          filtersOn(call, 'in').includes('template_id'),
      ],
      [
        'the names of those rules',
        (call: Call) =>
          call.table === 'cw_rule_templates' &&
          filtersOn(call, 'in').includes('id'),
      ],
    ])('%s', async (_name, failSelect) => {
      const { service, world } = buildService(tables(), both());
      world.failSelect = failSelect;

      await expect(service.findOne(1, customer)).rejects.toThrow(
        'Failed to load rule status',
      );
    });

    it('every device of the rule, before a start or pause', async () => {
      const { service, world } = buildService(tables(), both());
      world.failSelect = (call) =>
        call.table === 'cw_device_rule_assignments' &&
        filtersOn(call, 'in').length === 0;

      await expect(service.setRunning(1, false, customer)).rejects.toThrow(
        'Failed to load rule assignments',
      );
      expect(world.rpc).not.toHaveBeenCalled();
    });

    it.each([
      [
        'the devices of the rules on offer',
        'cw_device_rule_assignments',
        'Failed to load rule assignments',
      ],
      [
        'the names of the rules on offer',
        'cw_rule_templates',
        'Failed to load rule templates',
      ],
    ])('%s', async (_name, table, message) => {
      const { service, world } = buildService(tables(), both());
      world.failSelect = (call) =>
        call.table === table &&
        filtersOn(call, 'in').includes(
          table === 'cw_rule_templates' ? 'id' : 'template_id',
        );

      await expect(service.getFormContext(customer)).rejects.toThrow(message);
    });
  });
});
