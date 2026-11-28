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
import type { SaveRuleTemplateDto } from './dto/save-rule-template.dto';
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
  /** `table:insert|update|delete` -> error to answer that write with. */
  writeErrors: Record<string, unknown>;
  /** What cw_rule_switch answers; the default really flips is_active. */
  switchResult: Result | null;
}

/** A column, or a JSON text path like `config->>targetTemplateId`. */
function readColumn(row: Row, column: string): unknown {
  if (!column.includes('->>')) return row[column];
  const [json, key] = column.split('->>');
  const value = (row[json] as Row | null | undefined)?.[key];
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : undefined;
}

function applyFilters(rows: Row[], filters: Filter[]): Row[] {
  return rows.filter((row) =>
    filters.every(({ method, args }) => {
      const [column, value] = args as [string, unknown];
      if (method === 'eq') return readColumn(row, column) === value;
      if (method === 'in')
        return (value as unknown[]).includes(readColumn(row, column));
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
      cw_rule_action_types: [
        { id: 2, name: 'EMail', created_at: '' },
        { id: 3, name: 'LoRaWAN', created_at: '' },
        { id: 5, name: 'Push', created_at: '' },
        { id: 6, name: 'RuleActivate', created_at: '' },
        { id: 7, name: 'RuleDeactivate', created_at: '' },
        { id: 8, name: 'RuleDeactivateSelf', created_at: '' },
      ],
      cw_rule_template_schedules: [],
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
    writeErrors: {},
    switchResult: null,
  };
  let nextId = 900;

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
        const writeError = world.writeErrors[`${table}:${call.op}`];
        if (writeError) return { data: null, error: writeError };
        if (call.op === 'insert' && table === 'cw_rule_templates') {
          const row = {
            id: nextId++,
            trigger_kind: 'sensor',
            org_id: null,
            created_at: null,
            ...(call.payload as Row),
          };
          world.tables.cw_rule_templates.push(row);
          return { data: row, error: null };
        }
        if (call.op === 'insert' && table === 'cw_rule_template_schedules') {
          const payload = call.payload as Row;
          const rule = world.tables.cw_rule_templates.find(
            (row) => row.id === payload.template_id,
          );
          // What the database trigger does: a running rule gets a next run.
          world.tables[table].push({
            next_fire_at:
              (rule?.is_active ?? true) ? '2099-01-01T00:00:00+00:00' : null,
            last_fired_at: null,
            ...payload,
          });
        } else if (call.op === 'insert' && world.tables[table]) {
          for (const row of [call.payload as Row | Row[]].flat()) {
            world.tables[table].push({ id: nextId++, ...row });
          }
        }
        if (call.op === 'update' && world.tables[table]) {
          for (const row of applyFilters(world.tables[table], call.filters)) {
            Object.assign(row, call.payload);
          }
        }
        if (
          call.op === 'delete' &&
          world.tables[table] &&
          // Deletes with a `not ... in` filter (state clean-up) are only recorded.
          call.filters.every((filter) => filter.method === 'eq')
        ) {
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
      const rows = applyFilters(world.tables[table], call.filters).map(
        (row) => {
          if (table === 'cw_device_rule_assignments') {
            return {
              ...row,
              // The cw_devices(org_id) embed of listRuleOptions.
              cw_devices: world.tables.cw_devices?.find(
                (device) => device.dev_eui === row.dev_eui,
              ),
            };
          }
          if (table === 'cw_rule_template_actions') {
            // The cw_rule_action_types(id, name) embed.
            return {
              ...row,
              cw_rule_action_types: world.tables.cw_rule_action_types.find(
                (type) => type.id === row.action_type,
              ),
            };
          }
          return row;
        },
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
  /** The organizations the caller is owner or manager of. */
  managedOrgIds: string[] = [],
) {
  const { world, client } = buildWorld(tables);
  const accessService = {
    getManagedOrgIds: jest.fn().mockResolvedValue(managedOrgIds),
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

  describe('re-send while the alarm stays open', () => {
    const state = (
      id: number,
      templateId: number,
      overrides: Row = {},
    ): Row => ({
      id,
      dev_eui: 'AA',
      template_id: templateId,
      is_triggered: true,
      last_triggered_at: '2026-11-26T00:00:00+00:00',
      last_reset_at: null,
      reports_since_send: 2,
      resend_count: 3,
      last_counted_at: '2026-11-27T02:30:00+00:00',
      last_resend_at: '2026-11-27T01:00:00+00:00',
      ...overrides,
    });
    const tables = (overrides: Row = {}) => ({
      cw_rule_templates: [
        template(1, 'Freezer temp', overrides),
        template(2, 'Other rule', { resend_after_reports: 4, resend_max: 5 }),
      ],
      cw_device_rule_assignments: [...assign(1, 'AA'), ...assign(2, 'AA')],
      cw_devices: [device('AA', ORG_A)],
      cw_rule_state: [state(20, 1), state(21, 2)],
    });
    const manageAA = () => access({ AA: 'manage' });
    const COUNTING = {
      reports_since_send: 2,
      resend_count: 3,
      last_counted_at: '2026-11-27T02:30:00+00:00',
      last_resend_at: '2026-11-27T01:00:00+00:00',
    };
    const ZEROED = {
      reports_since_send: 0,
      resend_count: 0,
      last_counted_at: null,
      last_resend_at: null,
    };
    const stateWrites = (world: World) =>
      world.calls.filter(
        (call) => call.table === 'cw_rule_state' && call.op === 'update',
      );

    it('is off for a rule that never set it, with the default of 5 re-sends', async () => {
      const { service } = buildService(tables(), manageAA());

      const rule = await service.findOne(1, customer);

      expect(rule.resendAfterReports).toBeNull();
      expect(rule.resendMax).toBe(5);
    });

    it('a new rule stores the setting only when it is given', async () => {
      const { service, world } = buildService(tables(), manageAA());
      const inserted = () =>
        world.calls
          .filter(
            (call) =>
              call.table === 'cw_rule_templates' && call.op === 'insert',
          )
          .map((call) => call.payload as Row);

      const rule = await service.create(
        savePayload(['AA'], { resendAfterReports: 3, resendMax: 4 }),
        customer,
      );
      await service.create(savePayload(['AA']), customer);
      await service.create(
        savePayload(['AA'], { resendAfterReports: null }),
        customer,
      );

      expect(inserted()[0]).toMatchObject({
        resend_after_reports: 3,
        resend_max: 4,
      });
      expect(rule).toMatchObject({ resendAfterReports: 3, resendMax: 4 });
      // Left out: the column defaults apply (off, at most 5).
      expect(inserted()[1]).not.toHaveProperty('resend_after_reports');
      expect(inserted()[1]).not.toHaveProperty('resend_max');
      expect(inserted()[2]).toMatchObject({ resend_after_reports: null });
      expect(inserted()[2]).not.toHaveProperty('resend_max');
    });

    it.each([
      ['fewer than 3 reports', { resendAfterReports: 2 }],
      ['more than 1000 reports', { resendAfterReports: 1001 }],
      ['half a report', { resendAfterReports: 3.5 }],
      ['a number as text', { resendAfterReports: '3' }],
      ['no re-sends at all', { resendAfterReports: 3, resendMax: 0 }],
      ['more than 50 re-sends', { resendAfterReports: 3, resendMax: 51 }],
      ['half a re-send', { resendAfterReports: 3, resendMax: 1.5 }],
      ['a cap as text', { resendMax: '5' }],
    ])(
      'refuses %s, on create and on save, before anything is written',
      async (_name, extra) => {
        const { service, world } = buildService(tables(), manageAA());

        await expect(
          service.create(
            savePayload(['AA'], extra) as SaveRuleTemplateDto,
            customer,
          ),
        ).rejects.toBeInstanceOf(BadRequestException);
        await expect(
          service.update(
            1,
            savePayload(['AA'], extra) as SaveRuleTemplateDto,
            customer,
          ),
        ).rejects.toBeInstanceOf(BadRequestException);

        expect(world.log).toEqual([]);
      },
    );

    it('accepts the limits: 3 and 1000 reports, 1 and 50 re-sends', async () => {
      const { service } = buildService(tables(), manageAA());

      const low = await service.update(
        1,
        savePayload(['AA'], { resendAfterReports: 3, resendMax: 1 }),
        customer,
      );
      const high = await service.update(
        1,
        savePayload(['AA'], { resendAfterReports: 1000, resendMax: 50 }),
        customer,
      );

      expect(low).toMatchObject({ resendAfterReports: 3, resendMax: 1 });
      expect(high).toMatchObject({ resendAfterReports: 1000, resendMax: 50 });
    });

    it('a changed setting is saved, and every open alarm of that rule starts counting afresh', async () => {
      const { service, world } = buildService(tables(), manageAA());

      const rule = await service.update(
        1,
        savePayload(['AA'], { resendAfterReports: 6, resendMax: 2 }),
        customer,
      );

      expect(templateWrites(world)).toEqual([
        {
          name: 'Freezer temp',
          description: null,
          device_type_id: null,
          resend_after_reports: 6,
          resend_max: 2,
        },
      ]);
      expect(rule).toMatchObject({ resendAfterReports: 6, resendMax: 2 });
      expect(stateWrites(world)).toHaveLength(1);
      expect(stateWrites(world)[0]).toMatchObject({
        payload: ZEROED,
        filters: [{ method: 'eq', args: ['template_id', 1] }],
      });
      // The alarm itself is untouched, and so is the other rule's count.
      expect(world.tables.cw_rule_state[0]).toMatchObject({
        is_triggered: true,
        last_triggered_at: '2026-11-26T00:00:00+00:00',
        ...ZEROED,
      });
      expect(world.tables.cw_rule_state[1]).toMatchObject(COUNTING);
    });

    it('a save that leaves the setting as it is, or does not mention it, resets nothing', async () => {
      const { service, world } = buildService(
        tables({ resend_after_reports: 3, resend_max: 5 }),
        manageAA(),
      );

      await service.update(
        1,
        savePayload(['AA'], { resendAfterReports: 3, resendMax: 5 }),
        customer,
      );
      const untouched = await service.update(1, savePayload(['AA']), customer);

      for (const write of templateWrites(world)) {
        expect(write).toEqual({
          name: 'Freezer temp',
          description: null,
          device_type_id: null,
        });
      }
      expect(stateWrites(world)).toHaveLength(0);
      expect(world.tables.cw_rule_state[0]).toMatchObject(COUNTING);
      // An old app that does not know the setting keeps it.
      expect(untouched).toMatchObject({ resendAfterReports: 3, resendMax: 5 });
    });

    it('only the changed half is written: the cap alone, or off alone', async () => {
      const capOnly = buildService(
        tables({ resend_after_reports: 3, resend_max: 5 }),
        manageAA(),
      );
      await capOnly.service.update(
        1,
        savePayload(['AA'], { resendAfterReports: 3, resendMax: 9 }),
        customer,
      );
      expect(templateWrites(capOnly.world)[0]).toEqual({
        name: 'Freezer temp',
        description: null,
        device_type_id: null,
        resend_max: 9,
      });
      expect(stateWrites(capOnly.world)).toHaveLength(1);

      const off = buildService(
        tables({ resend_after_reports: 3, resend_max: 5 }),
        manageAA(),
      );
      const rule = await off.service.update(
        1,
        savePayload(['AA'], { resendAfterReports: null }),
        customer,
      );
      expect(templateWrites(off.world)[0]).toEqual({
        name: 'Freezer temp',
        description: null,
        device_type_id: null,
        resend_after_reports: null,
      });
      expect(rule.resendAfterReports).toBeNull();
      expect(rule.resendMax).toBe(5);
      expect(off.world.tables.cw_rule_state[0]).toMatchObject(ZEROED);
    });

    it('fails loudly when the counters cannot be reset', async () => {
      const { service, world } = buildService(tables(), manageAA());
      world.writeErrors['cw_rule_state:update'] = { message: 'boom' };

      await expect(
        service.update(
          1,
          savePayload(['AA'], { resendAfterReports: 3 }),
          customer,
        ),
      ).rejects.toThrow('Failed to reset the re-send counters');
    });

    describe('which actions are sent again ("repeat")', () => {
      const actionsOf = (world: World) =>
        world.calls
          .filter(
            (call) =>
              call.table === 'cw_rule_template_actions' && call.op === 'insert',
          )
          .flatMap((call) => call.payload as Row[])
          .map((row) => row.config);

      it('is kept, true or false, on notifications and relays', async () => {
        const { service, world } = buildService(tables(), manageAA());
        const relay = JSON.stringify({
          devEui: 'RELAY',
          downlink: { f_port: 2, frm_payload: 'BQEAOpg=' },
        });

        const rule = await service.update(
          1,
          savePayload(['AA'], {
            resendAfterReports: 3,
            actions: [
              {
                actionType: 2,
                config: { recipient: 'a@example.com', repeat: true },
              },
              { actionType: 5, config: { recipient: '{}', repeat: false } },
              { actionType: 3, config: { recipient: relay, repeat: true } },
              { actionType: 2, config: { recipient: 'b@example.com' } },
            ],
          }),
          customer,
        );

        expect(actionsOf(world)).toEqual([
          { recipient: 'a@example.com', repeat: true },
          { recipient: '{}', repeat: false },
          { recipient: relay, repeat: true },
          { recipient: 'b@example.com' },
        ]);
        expect(rule.actions.map((action) => action.config)).toEqual(
          actionsOf(world),
        );
      });

      it.each([['yes'], [1], [null], [{ every: 3 }]])(
        'must be true or false (%p is refused before anything is written)',
        async (repeat) => {
          const { service, world } = buildService(tables(), manageAA());

          await expect(
            service.update(
              1,
              savePayload(['AA'], {
                actions: [
                  { actionType: 2, config: { recipient: 'a@example.com' } },
                  {
                    actionType: 2,
                    config: { recipient: 'b@example.com', repeat },
                  },
                ],
              }) as SaveRuleTemplateDto,
              customer,
            ),
          ).rejects.toThrow('Action 2: "repeat" must be true or false');
          expect(world.log).toEqual([]);
        },
      );

      it('a relay is sent again only as a timed pulse: a fixed on/off command is stored as not repeated', async () => {
        const { service, world } = buildService(tables(), manageAA());
        const fixed = JSON.stringify({
          devEui: 'RELAY',
          downlink: { f_port: 2, frm_payload: 'AwER' },
        });

        await service.update(
          1,
          savePayload(['AA'], {
            actions: [
              { actionType: 3, config: { recipient: fixed, repeat: true } },
              { actionType: 3, config: { recipient: fixed, repeat: false } },
            ],
          }),
          customer,
        );

        expect(actionsOf(world)).toEqual([
          { recipient: fixed, repeat: false },
          { recipient: fixed, repeat: false },
        ]);
      });

      it('never reaches an action that switches a rule', async () => {
        const { service, world } = buildService(tables(), manageAA());

        await service.update(
          1,
          savePayload(['AA'], {
            actions: [
              { actionType: 8, config: { recipient: 'self', repeat: true } },
              { actionType: 7, config: { targetTemplateId: 2, repeat: true } },
            ],
          }),
          customer,
        );

        expect(actionsOf(world)).toEqual([
          { recipient: 'self' },
          { recipient: '2', targetTemplateId: 2 },
        ]);
      });
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
        { id: 3, name: 'Autumn', orgId: ORG_A, triggerKind: 'sensor' },
        { id: 2, name: 'Winter', orgId: ORG_A, triggerKind: 'sensor' },
      ]);
      // Not an owner or manager of any organization: no Date/Time rules.
      expect(context.canManageDateTimeRules).toBe(false);
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

describe('RulesService: Date/Time rules and rule-switch actions', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.setSystemTime(NOW);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  const EMAIL = 2;
  const RELAY = 3;
  const ACTIVATE = 6;
  const DEACTIVATE = 7;
  const DEACTIVATE_SELF = 8;
  const SCHEDULE = {
    timeOfDay: '09:00',
    daysOfWeek: [1, 3, 5],
    timezone: 'Asia/Tokyo',
  };

  const dateTimeTemplate = (id: number, name: string, overrides: Row = {}) =>
    template(id, name, {
      trigger_kind: 'schedule',
      org_id: ORG_A,
      ...overrides,
    });
  const scheduleRow = (templateId: number, overrides: Row = {}): Row => ({
    template_id: templateId,
    time_of_day: '09:00:00',
    days_of_week: [1, 3, 5],
    timezone: 'Asia/Tokyo',
    next_fire_at: '2026-11-30T00:00:00+00:00',
    last_fired_at: null,
    ...overrides,
  });
  let nextActionId = 100;
  const actionRow = (
    templateId: number,
    actionType: number,
    config: Row,
  ): Row => ({
    id: nextActionId++,
    template_id: templateId,
    action_type: actionType,
    config,
    created_at: null,
  });
  const switchAction = (actionType: number, targetTemplateId?: number) => ({
    actionType,
    config:
      targetTemplateId === undefined
        ? { recipient: 'self' }
        : { recipient: String(targetTemplateId), targetTemplateId },
  });
  const relayAction = (devEui: string) => ({
    actionType: RELAY,
    config: {
      recipient: JSON.stringify({
        devEui,
        downlink: { f_port: 2, frm_payload: 'AwEA' },
      }),
    },
  });
  const dateTimePayload = (actions: Row[], extra: Row = {}) =>
    ({
      name: 'Every morning',
      triggerKind: 'schedule',
      schedule: SCHEDULE,
      devEuis: [],
      criteria: [],
      actions,
      ...extra,
    }) as unknown as SaveRuleTemplateDto;

  /** Two sensor rules in A, one in B, one spanning both; a relay in A and one in B. */
  const tables = (extra: Record<string, Row[]> = {}) => ({
    cw_rule_templates: [
      template(1, 'Day alarm'),
      template(2, 'Night alarm', { is_active: false }),
      template(3, 'Other organization'),
      template(4, 'Two organizations'),
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
      device('RELAY-A', ORG_A),
      device('RELAY-B', ORG_B),
    ],
    ...extra,
  });
  const everything = () =>
    access({
      AA: 'manage',
      A2: 'manage',
      B1: 'manage',
      'RELAY-A': 'manage',
      'RELAY-B': 'manage',
    });
  /** A manager of organization A who manages all its devices. */
  const asManager = (extra: Record<string, Row[]> = {}) =>
    buildService(tables(extra), everything(), [ORG_A]);
  const writes = (world: World, table: string, op: Call['op']) =>
    world.calls
      .filter((call) => call.table === table && call.op === op)
      .map((call) => call.payload);

  describe('reading', () => {
    const withDateTimeRules = () => ({
      cw_rule_templates: [
        template(1, 'Day alarm'),
        dateTimeTemplate(10, 'Evening switch'),
        dateTimeTemplate(11, 'Their switch', { org_id: ORG_B }),
      ],
      cw_device_rule_assignments: assign(1, 'AA'),
      cw_rule_template_schedules: [scheduleRow(10), scheduleRow(11)],
      cw_rule_template_actions: [
        actionRow(10, ACTIVATE, { recipient: '1', targetTemplateId: 1 }),
      ],
    });

    it('lists a Date/Time rule to the managers of its organization, with its schedule and without devices', async () => {
      const { service } = buildService(
        withDateTimeRules(),
        access({ AA: 'manage' }),
        [ORG_A],
      );

      const rules = await service.findAll(customer);

      expect(rules.map((rule) => rule.name)).toEqual([
        'Day alarm',
        'Evening switch',
      ]);
      expect(rules[0]).toMatchObject({
        triggerKind: 'sensor',
        orgId: null,
        schedule: null,
      });
      expect(rules[1]).toMatchObject({
        id: 10,
        triggerKind: 'schedule',
        orgId: ORG_A,
        deviceTypeId: null,
        assignments: [],
        criteria: [],
        schedule: {
          timeOfDay: '09:00',
          daysOfWeek: [1, 3, 5],
          timezone: 'Asia/Tokyo',
          nextFireAt: '2026-11-30T00:00:00+00:00',
          lastFiredAt: null,
        },
        status: { state: 'running' },
      });
      expect(rules[1].actions).toHaveLength(1);
      expect(rules[1].actions[0]).toMatchObject({
        actionTypeName: 'RuleActivate',
        config: { targetTemplateId: 1 },
      });
    });

    it('does not show it to someone who only has the devices', async () => {
      const { service } = buildService(
        withDateTimeRules(),
        access({ AA: 'manage' }),
      );

      expect((await service.findAll(customer)).map((r) => r.id)).toEqual([1]);
      await expect(service.findOne(10, customer)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('shows staff the Date/Time rules of every organization', async () => {
      const { service } = buildService(withDateTimeRules(), access({}));

      expect((await service.findAll(staff)).map((rule) => rule.id)).toEqual([
        10, 11,
      ]);
      await expect(service.findOne(11, staff)).resolves.toMatchObject({
        orgId: ORG_B,
      });
    });

    it('gives one Date/Time rule to a manager of its organization only', async () => {
      const manager = buildService(withDateTimeRules(), access({}), [ORG_A]);

      await expect(
        manager.service.findOne(10, customer),
      ).resolves.toMatchObject({
        id: 10,
        triggerKind: 'schedule',
        schedule: { timeOfDay: '09:00' },
      });
      // Another organization's rule answers exactly like a rule that does not exist.
      await expect(
        manager.service.findOne(11, customer),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('lists a Date/Time rule without a schedule row, so it can be repaired', async () => {
      const { service } = buildService(
        { ...withDateTimeRules(), cw_rule_template_schedules: [] },
        access({}),
        [ORG_A],
      );

      const [rule] = await service.findAll(customer);
      expect(rule).toMatchObject({ id: 10, schedule: null });
    });

    it('names a Date/Time rule in a status only to those who may see that rule', async () => {
      const started = {
        cw_rule_templates: [
          template(1, 'Day alarm', {
            status_reason: 'rule_action',
            status_changed_by_template: 10,
          }),
          dateTimeTemplate(10, 'Evening switch'),
        ],
        cw_device_rule_assignments: assign(1, 'AA'),
        cw_rule_template_schedules: [scheduleRow(10)],
      };

      const viewer = await buildService(
        started,
        access({ AA: 'view' }),
      ).service.findOne(1, customer);
      const manager = await buildService(started, access({ AA: 'view' }), [
        ORG_A,
      ]).service.findOne(1, customer);

      expect(viewer.status.byRule).toEqual({ id: 10, name: null });
      expect(manager.status.byRule).toEqual({ id: 10, name: 'Evening switch' });
    });

    it('fails loudly when the schedules cannot be read', async () => {
      const { service, world } = buildService(withDateTimeRules(), access({}), [
        ORG_A,
      ]);
      world.selectErrors.cw_rule_template_schedules = { message: 'boom' };

      await expect(service.findAll(customer)).rejects.toThrow(
        'Failed to load rule schedules',
      );
    });
  });

  describe('creating a Date/Time rule', () => {
    it('stores the rule for the organization of what it switches, its schedule and its tidied actions', async () => {
      const { service, world } = asManager();

      const rule = await service.create(
        dateTimePayload([
          {
            actionType: ACTIVATE,
            // Whatever else the client sent is dropped.
            config: { targetTemplateId: 2, recipient: 'x', extra: true },
          },
          switchAction(DEACTIVATE, 1),
          switchAction(DEACTIVATE_SELF),
        ]),
        customer,
      );

      expect(writes(world, 'cw_rule_templates', 'insert')).toEqual([
        {
          name: 'Every morning',
          description: null,
          device_type_id: null,
          is_active: true,
          trigger_kind: 'schedule',
          org_id: ORG_A,
          auto_start_at: null,
          auto_pause_at: null,
          on_auto_pause_start_template_id: null,
        },
      ]);
      expect(writes(world, 'cw_rule_template_schedules', 'insert')).toEqual([
        {
          template_id: rule.id,
          time_of_day: '09:00',
          days_of_week: [1, 3, 5],
          timezone: 'Asia/Tokyo',
        },
      ]);
      expect(writes(world, 'cw_rule_template_actions', 'insert')).toEqual([
        [
          {
            template_id: rule.id,
            action_type: ACTIVATE,
            config: { recipient: '2', targetTemplateId: 2 },
          },
          {
            template_id: rule.id,
            action_type: DEACTIVATE,
            config: { recipient: '1', targetTemplateId: 1 },
          },
          {
            template_id: rule.id,
            action_type: DEACTIVATE_SELF,
            config: { recipient: 'self' },
          },
        ],
      ]);
      // No devices, no conditions.
      expect(writes(world, 'cw_device_rule_assignments', 'insert')).toEqual([]);
      expect(writes(world, 'cw_rule_template_criteria', 'insert')).toEqual([]);
      expect(rule).toMatchObject({
        triggerKind: 'schedule',
        orgId: ORG_A,
        schedule: { timeOfDay: '09:00', timezone: 'Asia/Tokyo' },
        status: { state: 'running' },
      });
      expect(rule.actions).toHaveLength(3);
    });

    it('takes its organization from a relay it commands', async () => {
      const { service, world } = asManager();

      const rule = await service.create(
        dateTimePayload([relayAction('RELAY-A')]),
        customer,
      );

      expect(rule.orgId).toBe(ORG_A);
      // The relay command is stored as the alert service expects it.
      expect(writes(world, 'cw_rule_template_actions', 'insert')).toEqual([
        [
          {
            template_id: rule.id,
            action_type: RELAY,
            config: relayAction('RELAY-A').config,
          },
        ],
      ]);
    });

    it('can be created paused, with a start date', async () => {
      const { service } = asManager();

      const rule = await service.create(
        dateTimePayload([switchAction(ACTIVATE, 2)], {
          isActive: false,
          autoStartAt: SOON,
        }),
        customer,
      );

      expect(rule).toMatchObject({
        isActive: false,
        autoStartAt: SOON,
        // Paused: the database gives it no next run.
        schedule: { nextFireAt: null },
        status: { state: 'scheduled' },
      });
    });

    it('is for the owner and managers of the organization only', async () => {
      // Manages every device, but is not an owner or manager of the organization.
      const { service, world } = buildService(tables(), everything());

      await expect(
        service.create(dateTimePayload([switchAction(ACTIVATE, 2)]), customer),
      ).rejects.toThrow(
        new ForbiddenException(
          'Only the owner and the managers of the organization can manage its Date/Time rules',
        ),
      );
      expect(world.log).toEqual([]);
    });

    it('lets staff create one for any organization', async () => {
      const { service } = buildService(tables(), everything());

      await expect(
        service.create(dateTimePayload([switchAction(DEACTIVATE, 3)]), staff),
      ).resolves.toMatchObject({ orgId: ORG_B });
    });

    it.each<[string, () => unknown, string | RegExp]>([
      [
        'no schedule',
        () =>
          dateTimePayload([switchAction(ACTIVATE, 2)], { schedule: undefined }),
        'A Date/Time rule needs a time, at least one weekday and a time zone',
      ],
      [
        'a time zone given as an offset',
        () =>
          dateTimePayload([switchAction(ACTIVATE, 2)], {
            schedule: { ...SCHEDULE, timezone: '+09:00' },
          }),
        'The time zone must be an IANA name such as Asia/Tokyo',
      ],
      [
        'no actions',
        () => dateTimePayload([]),
        'At least one action is required',
      ],
      [
        'an e-mail action',
        () =>
          dateTimePayload([
            switchAction(ACTIVATE, 2),
            { actionType: EMAIL, config: { recipient: 'me@example.com' } },
          ]),
        'Action 2: a Date/Time rule can switch rules and relays, but cannot send notifications yet',
      ],
      [
        'an action type that does not exist',
        () => dateTimePayload([{ actionType: 99, config: {} }]),
        'Action 1 has an unknown type',
      ],
      [
        'a switch action without a rule',
        () => dateTimePayload([{ actionType: DEACTIVATE, config: {} }]),
        'Action 1: choose the rule to deactivate',
      ],
      [
        'a relay action without a relay',
        () =>
          dateTimePayload([
            { actionType: RELAY, config: { recipient: 'not json' } },
          ]),
        'Action 1: choose a relay and a command',
      ],
      [
        'only "Deactivate THIS rule"',
        () => dateTimePayload([switchAction(DEACTIVATE_SELF)]),
        'A Date/Time rule needs at least one action on another rule or on a relay',
      ],
      [
        'rules of two organizations',
        () =>
          dateTimePayload([
            switchAction(ACTIVATE, 2),
            switchAction(ACTIVATE, 3),
          ]),
        'Everything a Date/Time rule switches (rules and relays) must belong to one organization',
      ],
      [
        'a rule and a relay of different organizations',
        () =>
          dateTimePayload([switchAction(ACTIVATE, 2), relayAction('RELAY-B')]),
        'Everything a Date/Time rule switches (rules and relays) must belong to one organization',
      ],
      [
        'relays of two organizations',
        () => dateTimePayload([relayAction('RELAY-A'), relayAction('RELAY-B')]),
        'Everything a Date/Time rule switches (rules and relays) must belong to one organization',
      ],
      [
        'a rule that spans organizations',
        () => dateTimePayload([switchAction(ACTIVATE, 4)]),
        /same organization/,
      ],
      [
        'a rule that does not exist',
        () => dateTimePayload([switchAction(ACTIVATE, 77)]),
        'Action 1: the rule to activate was not found',
      ],
      [
        'a start date in the past',
        () =>
          dateTimePayload([switchAction(ACTIVATE, 2)], { autoStartAt: PAST }),
        'The start date must be in the future',
      ],
    ])('refuses %s, and writes nothing', async (_name, payload, message) => {
      const { service, world } = asManager();

      await expect(
        service.create(
          payload() as Parameters<RulesService['create']>[0],
          customer,
        ),
      ).rejects.toThrow(message);
      expect(world.log).toEqual([]);
    });

    it('refuses a rule or a relay the caller does not manage', async () => {
      const limited = () =>
        buildService(tables(), access({ AA: 'manage', A2: 'view' }), [ORG_A]);

      await expect(
        limited().service.create(
          dateTimePayload([switchAction(ACTIVATE, 2)]),
          customer,
        ),
      ).rejects.toThrow(
        new NotFoundException('Action 1: the rule to activate was not found'),
      );
      await expect(
        limited().service.create(
          dateTimePayload([switchAction(ACTIVATE, 1), relayAction('RELAY-A')]),
          customer,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('checks the rule to start after a pause date against its organization', async () => {
      const { service } = asManager();

      await expect(
        service.create(
          dateTimePayload([switchAction(ACTIVATE, 2)], {
            autoPauseAt: LATER,
            onAutoPauseStartTemplateId: 3,
          }),
          customer,
        ),
      ).rejects.toThrow(/same organization/);
      await expect(
        service.create(
          dateTimePayload([switchAction(ACTIVATE, 2)], {
            autoPauseAt: LATER,
            onAutoPauseStartTemplateId: 1,
          }),
          customer,
        ),
      ).resolves.toMatchObject({ onAutoPauseStartTemplateId: 1 });
    });

    it.each([
      [
        'a time zone the database does not know',
        {
          code: '22023',
          message: 'RULE_SCHEDULE: unknown time zone Asia/Tokyo',
        },
        'The time zone must be an IANA name such as Asia/Tokyo',
        BadRequestException,
      ],
      [
        'the same refusal without its error code',
        { message: 'RULE_SCHEDULE: unknown time zone Asia/Tokyo' },
        'The time zone must be an IANA name such as Asia/Tokyo',
        BadRequestException,
      ],
      [
        'any other failure of the schedule write',
        { code: '57014', message: 'timeout' },
        'Failed to save the rule schedule',
        InternalServerErrorException,
      ],
    ])(
      'takes the rule back when the schedule cannot be saved: %s',
      async (_name, error, message, exception) => {
        const { service, world } = asManager();
        world.writeErrors['cw_rule_template_schedules:insert'] = error;

        const attempt = service.create(
          dateTimePayload([switchAction(ACTIVATE, 2)]),
          customer,
        );

        await expect(attempt).rejects.toBeInstanceOf(exception);
        await expect(attempt).rejects.toThrow(message);
        expect(world.log).toContain('delete:cw_rule_templates');
        expect(
          world.tables.cw_rule_templates.some(
            (row) => row.trigger_kind === 'schedule',
          ),
        ).toBe(false);
      },
    );

    it('takes the rule back when its actions cannot be saved', async () => {
      const { service, world } = asManager();
      world.writeErrors['cw_rule_template_actions:insert'] = {
        message: 'boom',
      };

      await expect(
        service.create(dateTimePayload([switchAction(ACTIVATE, 2)]), customer),
      ).rejects.toThrow('Failed to save rule actions');
      expect(world.log).toContain('delete:cw_rule_templates');
    });

    it('fails loudly when the rule row cannot be created', async () => {
      const { service, world } = asManager();
      world.writeErrors['cw_rule_templates:insert'] = { message: 'boom' };

      await expect(
        service.create(dateTimePayload([switchAction(ACTIVATE, 2)]), customer),
      ).rejects.toThrow('Failed to create rule template');
    });
  });

  describe('re-send and Date/Time rules', () => {
    it('refuses a re-send setting: a Date/Time rule has no reports to count', async () => {
      const { service, world } = asManager();

      await expect(
        service.create(
          dateTimePayload([switchAction(ACTIVATE, 1)], {
            resendAfterReports: 3,
          }),
          customer,
        ),
      ).rejects.toThrow(
        'A Date/Time rule has no reports to count, so it cannot re-send',
      );
      expect(world.log).toEqual([]);
    });

    it('accepts "off", and drops "repeat" from its relay action', async () => {
      const { service, world } = asManager();
      const relay = relayAction('RELAY-A');

      const rule = await service.create(
        dateTimePayload(
          [{ ...relay, config: { ...relay.config, repeat: true } }],
          { resendAfterReports: null, resendMax: 9 },
        ),
        customer,
      );

      const stored = (
        writes(world, 'cw_rule_template_actions', 'insert') as Row[][]
      )
        .flat()
        .map((row) => row.config);
      expect(stored).toEqual([relay.config]);
      expect(rule.resendAfterReports).toBeNull();
      // Neither setting is written for a Date/Time rule.
      const inserted = writes(world, 'cw_rule_templates', 'insert')[0];
      expect(inserted).not.toHaveProperty('resend_after_reports');
      expect(inserted).not.toHaveProperty('resend_max');
    });

    it('still checks that "repeat" is true or false', async () => {
      const { service } = asManager();

      await expect(
        service.create(
          dateTimePayload([
            {
              ...relayAction('RELAY-A'),
              config: { ...relayAction('RELAY-A').config, repeat: 'yes' },
            },
          ]),
          customer,
        ),
      ).rejects.toThrow('Action 1: "repeat" must be true or false');
    });
  });

  describe('saving a Date/Time rule', () => {
    const existing = (overrides: Row = {}, extra: Record<string, Row[]> = {}) =>
      asManager({
        cw_rule_templates: [
          ...tables().cw_rule_templates,
          dateTimeTemplate(10, 'Every morning', overrides),
          dateTimeTemplate(12, 'Evening switch'),
        ],
        cw_rule_template_schedules: [scheduleRow(10), scheduleRow(12)],
        cw_rule_template_actions: [
          actionRow(10, ACTIVATE, { recipient: '2', targetTemplateId: 2 }),
        ],
        ...extra,
      });

    it('leaves an unchanged schedule alone, so a run that is due this minute is not skipped', async () => {
      const { service, world } = existing();

      const rule = await service.update(
        10,
        dateTimePayload(
          [switchAction(ACTIVATE, 2), switchAction(DEACTIVATE, 1)],
          {
            name: 'Renamed',
            // Same schedule, weekdays in another order.
            schedule: { ...SCHEDULE, daysOfWeek: [5, 1, 3] },
          },
        ),
        customer,
      );

      expect(writes(world, 'cw_rule_template_schedules', 'update')).toEqual([]);
      expect(writes(world, 'cw_rule_template_schedules', 'insert')).toEqual([]);
      expect(templateWrites(world)).toEqual([
        { name: 'Renamed', description: null },
      ]);
      // Its actions are replaced; nothing about devices is written.
      expect(world.log).toEqual([
        'update:cw_rule_templates',
        'delete:cw_rule_template_actions',
        'insert:cw_rule_template_actions',
      ]);
      expect(rule.actions.map((action) => action.actionTypeName)).toEqual([
        'RuleActivate',
        'RuleDeactivate',
      ]);
      expect(world.rpc).not.toHaveBeenCalled();
    });

    it('writes a changed schedule', async () => {
      const { service, world } = existing();

      const rule = await service.update(
        10,
        dateTimePayload([switchAction(ACTIVATE, 2)], {
          schedule: {
            timeOfDay: '18:30',
            daysOfWeek: [6, 7],
            timezone: 'America/New_York',
          },
        }),
        customer,
      );

      expect(writes(world, 'cw_rule_template_schedules', 'update')).toEqual([
        {
          time_of_day: '18:30',
          days_of_week: [6, 7],
          timezone: 'America/New_York',
        },
      ]);
      expect(rule.schedule).toMatchObject({
        timeOfDay: '18:30',
        daysOfWeek: [6, 7],
        timezone: 'America/New_York',
      });
    });

    it('gives a rule that lost its schedule row a new one', async () => {
      const { service, world } = existing(
        {},
        { cw_rule_template_schedules: [] },
      );

      await service.update(
        10,
        dateTimePayload([switchAction(ACTIVATE, 2)]),
        customer,
      );

      expect(writes(world, 'cw_rule_template_schedules', 'insert')).toEqual([
        {
          template_id: 10,
          time_of_day: '09:00',
          days_of_week: [1, 3, 5],
          timezone: 'Asia/Tokyo',
        },
      ]);
    });

    it('pauses first and starts last, through cw_rule_switch', async () => {
      const pausing = existing();
      await pausing.service.update(
        10,
        dateTimePayload([switchAction(ACTIVATE, 2)], { isActive: false }),
        customer,
      );
      expect(pausing.world.log[0]).toBe('rpc:cw_rule_switch:pause');

      const starting = existing({ is_active: false });
      await starting.service.update(
        10,
        dateTimePayload([switchAction(ACTIVATE, 2)], { isActive: true }),
        customer,
      );
      expect(starting.world.log.at(-1)).toBe('rpc:cw_rule_switch:start');
    });

    it('can keep only "Deactivate THIS rule": its organization is already known', async () => {
      const { service } = existing();

      await expect(
        service.update(
          10,
          dateTimePayload([switchAction(DEACTIVATE_SELF)]),
          customer,
        ),
      ).resolves.toMatchObject({ orgId: ORG_A });
    });

    it('may switch another Date/Time rule of its organization', async () => {
      const { service } = existing();

      const rule = await service.update(
        10,
        dateTimePayload([switchAction(DEACTIVATE, 12)]),
        customer,
      );

      expect(rule.actions[0].config).toEqual({
        recipient: '12',
        targetTemplateId: 12,
      });
    });

    it.each<[string, () => unknown, string | RegExp]>([
      [
        'a rule of another organization',
        () => dateTimePayload([switchAction(ACTIVATE, 3)]),
        'Everything a Date/Time rule switches (rules and relays) must belong to one organization',
      ],
      [
        'a relay of another organization',
        () => dateTimePayload([relayAction('RELAY-B')]),
        'Everything a Date/Time rule switches (rules and relays) must belong to one organization',
      ],
      [
        'itself as the rule to deactivate',
        () => dateTimePayload([switchAction(DEACTIVATE, 10)]),
        'Action 1: a rule cannot deactivate itself this way',
      ],
      [
        'itself as the rule to start after its pause date',
        () =>
          dateTimePayload([switchAction(ACTIVATE, 2)], {
            autoPauseAt: LATER,
            onAutoPauseStartTemplateId: 10,
          }),
        'A rule cannot start itself',
      ],
      [
        'becoming a sensor rule',
        () => savePayload(['AA']),
        'A rule cannot be changed between a sensor rule and a Date/Time rule',
      ],
    ])('refuses %s, and writes nothing', async (_name, payload, message) => {
      const { service, world } = existing();

      await expect(
        service.update(
          10,
          payload() as Parameters<RulesService['update']>[1],
          customer,
        ),
      ).rejects.toThrow(message);
      expect(world.log).toEqual([]);
    });

    it('refuses to turn a sensor rule into a Date/Time rule', async () => {
      const { service, world } = existing();

      await expect(
        service.update(
          1,
          dateTimePayload([switchAction(ACTIVATE, 2)]),
          customer,
        ),
      ).rejects.toThrow(
        'A rule cannot be changed between a sensor rule and a Date/Time rule',
      );
      expect(world.log).toEqual([]);
    });

    it.each([
      ['cw_rule_templates:update', 'Failed to update rule template'],
      ['cw_rule_template_schedules:update', 'Failed to save the rule schedule'],
      ['cw_rule_template_actions:delete', 'Failed to remove rule actions'],
      ['cw_rule_template_actions:insert', 'Failed to save rule actions'],
    ])('fails loudly when %s fails', async (write, message) => {
      const { service, world } = existing();
      world.writeErrors[write] = { message: 'boom' };

      await expect(
        service.update(
          10,
          dateTimePayload([switchAction(ACTIVATE, 2)], {
            schedule: { ...SCHEDULE, timeOfDay: '10:00' },
          }),
          customer,
        ),
      ).rejects.toThrow(message);
    });

    it('starts and pauses from the list like any rule', async () => {
      const { service, world } = existing();

      const rule = await service.setRunning(10, false, customer);

      expect(world.log).toEqual(['rpc:cw_rule_switch:pause']);
      expect(rule.isActive).toBe(false);
    });
  });

  describe('rule-switch actions on a sensor rule', () => {
    it('saves them tidied, when the other rule is in the same organization', async () => {
      const { service, world } = buildService(tables(), everything());

      const rule = await service.update(
        1,
        savePayload(['AA'], {
          actions: [
            { actionType: EMAIL, config: { recipient: 'me@example.com' } },
            { actionType: ACTIVATE, config: { targetTemplateId: 2, junk: 1 } },
            { actionType: DEACTIVATE_SELF, config: { recipient: 'whatever' } },
          ],
        }),
        customer,
      );

      expect(writes(world, 'cw_rule_template_actions', 'insert')).toEqual([
        [
          {
            template_id: 1,
            action_type: EMAIL,
            config: { recipient: 'me@example.com' },
          },
          {
            template_id: 1,
            action_type: ACTIVATE,
            config: { recipient: '2', targetTemplateId: 2 },
          },
          {
            template_id: 1,
            action_type: DEACTIVATE_SELF,
            config: { recipient: 'self' },
          },
        ],
      ]);
      expect(rule.actions).toHaveLength(3);
    });

    it('may switch a Date/Time rule of an organization the caller manages', async () => {
      const withDateTime = () =>
        tables({
          cw_rule_templates: [
            ...tables().cw_rule_templates,
            dateTimeTemplate(10, 'Evening switch'),
          ],
        });
      const payload = () =>
        savePayload(['AA'], { actions: [switchAction(DEACTIVATE, 10)] });

      await expect(
        buildService(withDateTime(), everything(), [ORG_A]).service.update(
          1,
          payload(),
          customer,
        ),
      ).resolves.toMatchObject({ id: 1 });
      // Without managing that organization the Date/Time rule does not exist for them.
      await expect(
        buildService(withDateTime(), everything()).service.update(
          1,
          payload(),
          customer,
        ),
      ).rejects.toThrow('Action 1: the rule to deactivate was not found');
    });

    it.each<[string, Row, string | RegExp]>([
      [
        'a rule of another organization',
        switchAction(ACTIVATE, 3),
        /same organization/,
      ],
      [
        'a rule that spans organizations',
        switchAction(ACTIVATE, 4),
        /same organization/,
      ],
      [
        'itself',
        switchAction(DEACTIVATE, 1),
        'Action 1: a rule cannot deactivate itself this way',
      ],
      [
        'a rule that does not exist',
        switchAction(ACTIVATE, 77),
        'Action 1: the rule to activate was not found',
      ],
      [
        'no rule at all',
        { actionType: ACTIVATE, config: { recipient: '2' } },
        'Action 1: choose the rule to activate',
      ],
      [
        'an unknown action type',
        { actionType: 99, config: {} },
        'Action 1 has an unknown type',
      ],
    ])(
      'refuses to switch %s, and writes nothing',
      async (name, action, message) => {
        const { service, world } = buildService(tables(), everything());

        await expect(
          service.update(
            1,
            savePayload(['AA'], { actions: [action] }),
            customer,
          ),
        ).rejects.toThrow(message);
        // A rule being created has no id yet, so it cannot name itself.
        if (name !== 'itself') {
          await expect(
            service.create(
              savePayload(['AA'], { actions: [action] }),
              customer,
            ),
          ).rejects.toThrow(message);
        }
        expect(world.log).toEqual([]);
      },
    );

    it('refuses when this rule itself spans organizations', async () => {
      const { service } = buildService(tables(), everything());

      await expect(
        service.update(
          1,
          savePayload(['AA', 'B1'], { actions: [switchAction(ACTIVATE, 2)] }),
          customer,
        ),
      ).rejects.toThrow(/same organization/);
    });

    it('does not look at organizations when a rule switches nothing', async () => {
      const { service, world } = buildService(tables(), everything());
      world.selectErrors.cw_devices = { message: 'must not be read' };

      await expect(
        service.update(1, savePayload(['AA', 'B1']), customer),
      ).resolves.toMatchObject({ id: 1 });
    });
  });

  describe('deleting a rule other rules start or pause', () => {
    const dependents = () =>
      tables({
        cw_rule_templates: [
          template(1, 'Day alarm', {
            auto_pause_at: LATER,
            on_auto_pause_start_template_id: 2,
          }),
          template(2, 'Night alarm', { is_active: false }),
          template(3, 'Other organization'),
          dateTimeTemplate(10, 'Evening switch'),
        ],
        cw_device_rule_assignments: [
          ...assign(1, 'AA'),
          ...assign(2, 'A2'),
          ...assign(3, 'B1'),
        ],
        cw_rule_template_schedules: [scheduleRow(10)],
        cw_rule_template_actions: [
          actionRow(10, ACTIVATE, { recipient: '2', targetTemplateId: 2 }),
          // Not a switch action: a number that happens to be in its config does not count.
          actionRow(3, EMAIL, { recipient: 'x', targetTemplateId: 2 }),
        ],
      });

    it('is refused with the list of those rules, named when the caller can see them', async () => {
      const manager = buildService(dependents(), everything(), [ORG_A]);
      const member = buildService(dependents(), access({ A2: 'manage' }));

      const refused = (service: RulesService) =>
        service.remove(2, customer).then(
          () => null,
          (error: { getStatus(): number; getResponse(): unknown }) => ({
            status: error.getStatus(),
            body: error.getResponse(),
          }),
        );

      expect(await refused(manager.service)).toEqual({
        status: 409,
        body: {
          message:
            'Other rules start or pause this rule. They will no longer find it once it is deleted.',
          dependents: [
            { id: 1, name: 'Day alarm' },
            { id: 10, name: 'Evening switch' },
          ],
        },
      });
      // Sees neither rule: told that two rules depend on it, not which.
      expect(await refused(member.service)).toMatchObject({
        body: {
          dependents: [
            { id: 1, name: null },
            { id: 10, name: null },
          ],
        },
      });
      expect(manager.world.log).toEqual([]);
      expect(member.world.log).toEqual([]);
    });

    it('is done when the caller confirms', async () => {
      const { service, world } = buildService(dependents(), everything(), [
        ORG_A,
      ]);

      await expect(service.remove(2, customer, true)).resolves.toEqual({
        id: 2,
      });
      expect(world.log).toContain('delete:cw_rule_templates');
      expect(world.tables.cw_rule_templates.map((row) => row.id)).toEqual([
        1, 3, 10,
      ]);
    });

    it('needs no confirmation when nothing depends on the rule', async () => {
      const { service } = buildService(dependents(), everything(), [ORG_A]);

      await expect(service.remove(3, customer)).resolves.toEqual({ id: 3 });
    });

    it('lets a manager delete a Date/Time rule, and nobody else', async () => {
      const manager = buildService(dependents(), access({}), [ORG_A]);
      const member = buildService(dependents(), everything());

      await expect(member.service.remove(10, customer)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(manager.service.remove(10, customer)).resolves.toEqual({
        id: 10,
      });
      expect(manager.world.log).toContain('delete:cw_rule_template_actions');
    });

    it.each(['cw_rule_templates', 'cw_rule_template_actions'])(
      'fails loudly when the dependents cannot be read (%s)',
      async (table) => {
        const { service, world } = buildService(dependents(), everything(), [
          ORG_A,
        ]);
        world.failSelect = (call) =>
          call.table === table &&
          call.filters.some(
            (filter) =>
              // The two look-ups of the delete itself, not the status look-up.
              filter.method === 'eq' &&
              (filter.args[0] === 'on_auto_pause_start_template_id' ||
                filter.args[0] === 'config->>targetTemplateId'),
          );

        await expect(service.remove(2, customer)).rejects.toThrow(
          'Failed to load rule dependents',
        );
      },
    );
  });

  describe('the form context', () => {
    const context = () =>
      tables({
        cw_rule_templates: [
          ...tables().cw_rule_templates,
          dateTimeTemplate(10, 'Evening switch'),
          dateTimeTemplate(11, 'Their switch', { org_id: ORG_B }),
          dateTimeTemplate(12, 'Broken: no organization', { org_id: null }),
        ],
        cw_rule_action_types: [],
      });

    it('offers a manager the Date/Time rules of their organization next to the sensor rules', async () => {
      const { service } = buildService(context(), everything(), [ORG_A]);

      const result = await service.getFormContext(customer, 1);

      expect(result.ruleOptions).toEqual([
        {
          id: 10,
          name: 'Evening switch',
          orgId: ORG_A,
          triggerKind: 'schedule',
        },
        { id: 2, name: 'Night alarm', orgId: ORG_A, triggerKind: 'sensor' },
        {
          id: 3,
          name: 'Other organization',
          orgId: ORG_B,
          triggerKind: 'sensor',
        },
      ]);
      expect(result.canManageDateTimeRules).toBe(true);
    });

    it('offers staff every Date/Time rule that has an organization', async () => {
      const { service } = buildService(context(), access({}));

      const result = await service.getFormContext(staff);

      expect(result.ruleOptions.map((rule) => rule.id)).toEqual([10, 11]);
      expect(result.canManageDateTimeRules).toBe(true);
    });

    it('opens a Date/Time rule for editing, without itself among the options', async () => {
      const { service } = buildService(
        { ...context(), cw_rule_template_schedules: [scheduleRow(10)] },
        access({}),
        [ORG_A],
      );

      const result = await service.getFormContext(customer, 10);

      expect(result.template).toMatchObject({
        id: 10,
        triggerKind: 'schedule',
      });
      expect(result.ruleOptions).toEqual([]);
    });
  });
});
