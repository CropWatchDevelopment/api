import { SupabaseService } from '../../supabase/supabase.service';
import { PushService } from './push.service';

type StubResult = {
  data: unknown;
  error: { message: string; code?: string } | null;
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

function createService(adminClient?: { from: jest.Mock }) {
  return new PushService({
    getAdminClient: jest.fn(() => adminClient ?? { from: jest.fn() }),
  } as unknown as SupabaseService);
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
      expect(options).toEqual({ onConflict: 'token' });
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
  });

  describe('listTokens', () => {
    it("returns only the caller's rows, camel-cased", async () => {
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
          token: 'fcm-token-1',
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
      const managedLookup = chain({
        data: [
          {
            dev_eui: 'DEV-A',
            name: 'A',
            user_id: 'user-1',
            cw_device_owners: [],
          },
        ],
        error: null,
      });
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
        cw_devices: [managedLookup, viewersLookup],
        profiles: [profilesLookup],
        cw_push_tokens: [tokensLookup],
      });
      const service = createService(adminClient);

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
      const managedLookup = chain({ data: [], error: null });
      const adminClient = buildAdminClient({ cw_devices: [managedLookup] });
      const service = createService(adminClient);

      await expect(
        service.listEligibleRecipients(caller, ['DEV-X']),
      ).resolves.toEqual([]);
    });

    it('marks a user enrolled with multiple tokens as pushEnabled once', async () => {
      const managedLookup = chain({
        data: [
          {
            dev_eui: 'DEV-A',
            name: 'A',
            user_id: 'user-1',
            cw_device_owners: [],
          },
        ],
        error: null,
      });
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
        cw_devices: [managedLookup, viewersLookup],
        profiles: [profilesLookup],
        cw_push_tokens: [tokensLookup],
      });
      const service = createService(adminClient);

      const result = await service.listEligibleRecipients(caller, ['DEV-A']);

      expect(result).toEqual([
        { userId: 'multi-user', displayName: 'Multi', pushEnabled: true },
      ]);
    });
  });
});
