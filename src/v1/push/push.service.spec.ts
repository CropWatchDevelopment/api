import { SupabaseService } from '../../supabase/supabase.service';
import { AccessService } from '../common/authz';
import { PushService, pushDeviceId } from './push.service';

type StubResult = {
  data: unknown;
  error: { message: string; code?: string } | null;
  count?: number | null;
};

// Chainable, thenable query stub: filter methods record args and return the
// chain; awaiting resolves the configured result. Mirrors line.service.spec.ts
// with upsert added.
function chain(result: StubResult) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const stub: Record<string, unknown> = { calls };
  for (const method of [
    'select',
    'insert',
    'upsert',
    'update',
    'delete',
    'eq',
    'gt',
    'lt',
    'in',
    'like',
    'order',
  ]) {
    stub[method] = jest.fn((...args: unknown[]) => {
      calls.push({ method, args });
      return stub;
    });
  }
  stub.maybeSingle = jest.fn(() => Promise.resolve(result));
  stub.then = (resolve: (value: StubResult) => unknown) => resolve(result);
  return stub as Record<string, jest.Mock> & {
    calls: Array<{ method: string; args: unknown[] }>;
  };
}

function buildAdminClient(
  stubsByTable: Record<string, ReturnType<typeof chain>[]>,
) {
  const queues = new Map(
    Object.entries(stubsByTable).map(([k, v]) => [k, [...v]]),
  );
  const from = jest.fn((table: string) => {
    const queue = queues.get(table);
    if (!queue || queue.length === 0) {
      throw new Error(`Unexpected from('${table}')`);
    }
    return queue.length > 1 ? queue.shift()! : queue[0];
  });
  return { from };
}

function createService(
  adminClient?: { from: jest.Mock },
  accessService?: { listAccessibleDevices: jest.Mock },
) {
  return new PushService(
    {
      getAdminClient: jest.fn(() => adminClient ?? { from: jest.fn() }),
    } as unknown as SupabaseService,
    (accessService ?? {
      listAccessibleDevices: jest.fn().mockResolvedValue([]),
    }) as unknown as AccessService,
  );
}

describe('PushService', () => {
  describe('registerToken', () => {
    it('upserts on token with the caller as owner and a fresh last_seen_at', async () => {
      const upsert = chain({ data: null, error: null });
      const adminClient = buildAdminClient({ cw_push_tokens: [upsert] });
      const service = createService(adminClient);

      await service.registerToken('user-1', 'fcm-token-1', 'Pixel 9');

      const call = upsert.calls.find((c) => c.method === 'upsert');
      expect(call).toBeDefined();
      const [row, options] = call!.args as [
        Record<string, unknown>,
        Record<string, unknown>,
      ];
      expect(row.token).toBe('fcm-token-1');
      expect(row.user_id).toBe('user-1');
      expect(row.device_label).toBe('Pixel 9');
      expect(typeof row.last_seen_at).toBe('string');
      // Per (browser, account): another account on this browser keeps its row.
      expect(options).toEqual({ onConflict: 'token,user_id' });
    });

    it('stores a null device_label when none is provided', async () => {
      const upsert = chain({ data: null, error: null });
      const adminClient = buildAdminClient({ cw_push_tokens: [upsert] });
      const service = createService(adminClient);

      await service.registerToken('user-1', 'fcm-token-1');

      const call = upsert.calls.find((c) => c.method === 'upsert');
      const [row] = call!.args as [Record<string, unknown>];
      expect(row.device_label).toBeNull();
    });

    it('throws when the upsert fails', async () => {
      const upsert = chain({ data: null, error: { message: 'boom' } });
      const adminClient = buildAdminClient({ cw_push_tokens: [upsert] });
      const service = createService(adminClient);

      await expect(
        service.registerToken('user-1', 'fcm-token-1'),
      ).rejects.toThrow('Failed to register push token');
    });
  });

  describe('unregisterToken', () => {
    it('deletes only the caller-owned row for the token', async () => {
      const del = chain({ data: null, error: null });
      const adminClient = buildAdminClient({ cw_push_tokens: [del] });
      const service = createService(adminClient);

      await service.unregisterToken('user-1', 'fcm-token-1');

      expect(del.calls).toContainEqual({ method: 'delete', args: [] });
      expect(del.calls).toContainEqual({
        method: 'eq',
        args: ['token', 'fcm-token-1'],
      });
      expect(del.calls).toContainEqual({
        method: 'eq',
        args: ['user_id', 'user-1'],
      });
    });

    it('takes the user off every Push rule when their last device unsubscribes', async () => {
      const del = chain({ data: null, error: null });
      const remaining = chain({ data: null, error: null, count: 0 });
      const actionsLookup = chain({
        data: [
          {
            id: 11,
            config: {
              recipient: '{"userIds":["user-1","user-2"]}',
              note: 'kept',
            },
          },
          { id: 12, config: { recipient: '{"userIds":["user-1"]}' } },
          // Substring hit for 'user-1' that is a different user.
          { id: 13, config: { recipient: '{"userIds":["user-10"]}' } },
        ],
        error: null,
      });
      const update11 = chain({ data: null, error: null });
      const update12 = chain({ data: null, error: null });
      const adminClient = buildAdminClient({
        cw_push_tokens: [del, remaining],
        cw_rule_template_actions: [actionsLookup, update11, update12],
      });
      const service = createService(adminClient);

      await service.unregisterToken('user-1', 'fcm-token-1');

      expect(actionsLookup.calls).toContainEqual({
        method: 'eq',
        args: ['cw_rule_action_types.name', 'Push'],
      });
      expect(actionsLookup.calls).toContainEqual({
        method: 'like',
        args: ['config->>recipient', '%user-1%'],
      });
      expect(update11.calls).toEqual([
        {
          method: 'update',
          args: [
            {
              config: { recipient: '{"userIds":["user-2"]}', note: 'kept' },
            },
          ],
        },
        { method: 'eq', args: ['id', 11] },
      ]);
      expect(update12.calls).toEqual([
        {
          method: 'update',
          args: [{ config: { recipient: '{"userIds":[]}' } }],
        },
        { method: 'eq', args: ['id', 12] },
      ]);
    });

    it('leaves rules alone while the user still has another device enrolled', async () => {
      const del = chain({ data: null, error: null });
      const remaining = chain({ data: null, error: null, count: 1 });
      // No cw_rule_template_actions stub: touching rules would throw.
      const adminClient = buildAdminClient({
        cw_push_tokens: [del, remaining],
      });
      const service = createService(adminClient);

      await expect(
        service.unregisterToken('user-1', 'fcm-token-1'),
      ).resolves.toBeUndefined();
    });
  });

  describe('refreshToken', () => {
    it("re-stamps the caller's own row and reports it subscribed", async () => {
      const update = chain({ data: [{ token: 'fcm-token-1' }], error: null });
      const adminClient = buildAdminClient({ cw_push_tokens: [update] });
      const service = createService(adminClient);

      await expect(
        service.refreshToken('user-1', 'fcm-token-1', undefined, 'iPhone'),
      ).resolves.toBe(true);

      const call = update.calls.find((c) => c.method === 'update');
      const [row] = call!.args as [Record<string, unknown>];
      expect(row.device_label).toBe('iPhone');
      expect(typeof row.last_seen_at).toBe('string');
      expect(update.calls).toContainEqual({
        method: 'eq',
        args: ['token', 'fcm-token-1'],
      });
      expect(update.calls).toContainEqual({
        method: 'eq',
        args: ['user_id', 'user-1'],
      });
    });

    it('never turns push on for an account without a row on this browser', async () => {
      const update = chain({ data: [], error: null });
      const adminClient = buildAdminClient({ cw_push_tokens: [update] });
      const service = createService(adminClient);

      await expect(service.refreshToken('user-2', 'fcm-token-1')).resolves.toBe(
        false,
      );
      expect(
        update.calls.some(
          (c) => c.method === 'upsert' || c.method === 'insert',
        ),
      ).toBe(false);
    });

    it('moves every account on the browser when Firebase rotates its token', async () => {
      const previous = chain({
        data: [
          {
            user_id: 'user-1',
            device_label: 'Chrome on Linux',
            created_at: '2026-08-01T00:00:00Z',
          },
          {
            user_id: 'user-2',
            device_label: 'Chrome on Linux',
            created_at: '2026-09-01T00:00:00Z',
          },
        ],
        error: null,
      });
      const moved = chain({ data: null, error: null });
      const dropped = chain({ data: null, error: null });
      const restamp = chain({ data: [{ token: 'fcm-new' }], error: null });
      const adminClient = buildAdminClient({
        cw_push_tokens: [previous, moved, dropped, restamp],
      });
      const service = createService(adminClient);

      await expect(
        service.refreshToken('user-1', 'fcm-new', 'fcm-old'),
      ).resolves.toBe(true);

      expect(previous.calls).toContainEqual({
        method: 'eq',
        args: ['token', 'fcm-old'],
      });
      const upsert = moved.calls.find((c) => c.method === 'upsert');
      const [rows, options] = upsert!.args as [
        Array<Record<string, unknown>>,
        Record<string, unknown>,
      ];
      expect(rows.map((r) => [r.token, r.user_id, r.created_at])).toEqual([
        ['fcm-new', 'user-1', '2026-08-01T00:00:00Z'],
        ['fcm-new', 'user-2', '2026-09-01T00:00:00Z'],
      ]);
      expect(options).toEqual({ onConflict: 'token,user_id' });
      expect(dropped.calls).toEqual([
        { method: 'delete', args: [] },
        { method: 'eq', args: ['token', 'fcm-old'] },
      ]);
    });
  });

  describe('removeDevice', () => {
    it("removes the caller's matching device and runs the last-device cleanup", async () => {
      const owned = chain({
        data: [{ token: 'fcm-a' }, { token: 'fcm-b' }],
        error: null,
      });
      const del = chain({ data: null, error: null });
      const remaining = chain({ data: null, error: null, count: 0 });
      const actionsLookup = chain({ data: [], error: null });
      const adminClient = buildAdminClient({
        cw_push_tokens: [owned, del, remaining],
        cw_rule_template_actions: [actionsLookup],
      });
      const service = createService(adminClient);

      await expect(
        service.removeDevice('user-1', pushDeviceId('fcm-b')),
      ).resolves.toBe(true);

      expect(del.calls).toContainEqual({
        method: 'eq',
        args: ['token', 'fcm-b'],
      });
      expect(del.calls).toContainEqual({
        method: 'eq',
        args: ['user_id', 'user-1'],
      });
      expect(actionsLookup.calls).toContainEqual({
        method: 'like',
        args: ['config->>recipient', '%user-1%'],
      });
    });

    it("returns false for an id that isn't one of the caller's devices", async () => {
      const owned = chain({ data: [{ token: 'fcm-a' }], error: null });
      // One stub for the table: a delete would show up in its calls.
      const adminClient = buildAdminClient({ cw_push_tokens: [owned] });
      const service = createService(adminClient);

      await expect(
        service.removeDevice('user-1', pushDeviceId('someone-elses-token')),
      ).resolves.toBe(false);
      expect(owned.calls.some((c) => c.method === 'delete')).toBe(false);
    });
  });

  describe('listTokens', () => {
    it("returns the caller's devices with hashed ids, never raw tokens", async () => {
      const select = chain({
        data: [
          {
            token: 'fcm-token-1',
            device_label: 'Pixel 9',
            created_at: '2026-08-01T00:00:00Z',
            last_seen_at: '2026-08-20T00:00:00Z',
          },
        ],
        error: null,
      });
      const adminClient = buildAdminClient({ cw_push_tokens: [select] });
      const service = createService(adminClient);

      const result = await service.listTokens('user-1');

      expect(select.calls).toContainEqual({
        method: 'eq',
        args: ['user_id', 'user-1'],
      });
      expect(result).toEqual([
        {
          id: pushDeviceId('fcm-token-1'),
          deviceLabel: 'Pixel 9',
          createdAt: '2026-08-01T00:00:00Z',
          lastSeenAt: '2026-08-20T00:00:00Z',
        },
      ]);
    });
  });

  describe('listEligibleRecipients', () => {
    const caller = {
      sub: 'user-1',
      email: 'kevin@example.com',
      isStaff: false,
    };

    it('scopes to caller-viewable devices, includes the owner, excludes DISABLED, and maps pushEnabled', async () => {
      const accessService = {
        listAccessibleDevices: jest.fn().mockResolvedValue([
          {
            devEui: 'DEV-A',
            name: 'A',
            permissionLevel: 1,
            canView: true,
            canManage: true,
          },
        ]),
      };
      const viewersLookup = chain({
        data: [
          {
            user_id: 'owner-9',
            cw_device_owners: [
              { user_id: 'viewer-4', permission_level: 4 },
              { user_id: 'disabled-5', permission_level: 5 },
            ],
          },
        ],
        error: null,
      });
      const profilesLookup = chain({
        data: [
          {
            id: 'owner-9',
            full_name: 'Zoe Owner',
            username: null,
            email: null,
          },
          {
            id: 'viewer-4',
            full_name: null,
            username: null,
            email: 'v4@example.com',
          },
        ],
        error: null,
      });
      const tokensLookup = chain({
        data: [{ user_id: 'owner-9' }],
        error: null,
      });
      const adminClient = buildAdminClient({
        cw_devices: [viewersLookup],
        profiles: [profilesLookup],
        cw_push_tokens: [tokensLookup],
      });
      const service = createService(adminClient, accessService);

      const result = await service.listEligibleRecipients(caller, [
        'DEV-A',
        'DEV-NOT-VISIBLE',
      ]);

      // Scoped viewers query only includes the viewable device.
      expect(viewersLookup.calls).toContainEqual({
        method: 'in',
        args: ['dev_eui', ['DEV-A']],
      });
      // Sorted by display name; owner included; DISABLED excluded; fallback
      // chain and pushEnabled flags applied.
      expect(result).toEqual([
        {
          userId: 'viewer-4',
          displayName: 'v4@example.com',
          pushEnabled: false,
        },
        { userId: 'owner-9', displayName: 'Zoe Owner', pushEnabled: true },
      ]);
    });

    it('returns empty without further queries when the caller can view none', async () => {
      const accessService = {
        listAccessibleDevices: jest.fn().mockResolvedValue([]),
      };
      // Empty client: any from() call would throw.
      const service = createService(buildAdminClient({}), accessService);

      await expect(
        service.listEligibleRecipients(caller, ['DEV-X']),
      ).resolves.toEqual([]);
    });

    it('marks a user enrolled with multiple tokens as pushEnabled once', async () => {
      const accessService = {
        listAccessibleDevices: jest.fn().mockResolvedValue([
          {
            devEui: 'DEV-A',
            name: 'A',
            permissionLevel: 1,
            canView: true,
            canManage: true,
          },
        ]),
      };
      const viewersLookup = chain({
        data: [{ user_id: 'multi-user', cw_device_owners: [] }],
        error: null,
      });
      const profilesLookup = chain({
        data: [
          { id: 'multi-user', full_name: 'Multi', username: null, email: null },
        ],
        error: null,
      });
      const tokensLookup = chain({
        data: [{ user_id: 'multi-user' }, { user_id: 'multi-user' }],
        error: null,
      });
      const adminClient = buildAdminClient({
        cw_devices: [viewersLookup],
        profiles: [profilesLookup],
        cw_push_tokens: [tokensLookup],
      });
      const service = createService(adminClient, accessService);

      const result = await service.listEligibleRecipients(caller, ['DEV-A']);

      expect(result).toEqual([
        { userId: 'multi-user', displayName: 'Multi', pushEnabled: true },
      ]);
    });

    // A customer device with a CropWatch support account among its viewers.
    function serviceWithStaffViewer() {
      const accessService = {
        listAccessibleDevices: jest.fn().mockResolvedValue([
          {
            devEui: 'DEV-A',
            name: 'A',
            permissionLevel: 1,
            canView: true,
            canManage: true,
          },
        ]),
      };
      const adminClient = buildAdminClient({
        cw_devices: [
          chain({
            data: [
              {
                user_id: 'customer-1',
                cw_device_owners: [{ user_id: 'staff-2', permission_level: 1 }],
              },
            ],
            error: null,
          }),
        ],
        profiles: [
          chain({
            data: [
              {
                id: 'customer-1',
                full_name: 'Customer',
                username: null,
                email: 'farmer@example.com',
              },
              {
                id: 'staff-2',
                full_name: 'Support',
                username: null,
                email: 'Support@CropWatch.io',
              },
            ],
            error: null,
          }),
        ],
        cw_push_tokens: [chain({ data: [], error: null })],
      });
      return createService(adminClient, accessService);
    }

    it('hides CropWatch staff from non-staff callers', async () => {
      const result = await serviceWithStaffViewer().listEligibleRecipients(
        caller,
        ['DEV-A'],
      );

      expect(result.map((candidate) => candidate.userId)).toEqual([
        'customer-1',
      ]);
    });

    it('lists CropWatch staff for staff callers', async () => {
      const result = await serviceWithStaffViewer().listEligibleRecipients(
        { sub: 'staff-9', email: 'kevin@cropwatch.io', isStaff: true },
        ['DEV-A'],
      );

      expect(result.map((candidate) => candidate.userId)).toEqual([
        'customer-1',
        'staff-2',
      ]);
    });
  });
});
