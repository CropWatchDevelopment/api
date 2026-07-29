import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { SupabaseService } from '../../supabase/supabase.service';
import { LineApiClient } from './line-api.client';
import { LineService } from './line.service';

const CHANNEL_SECRET = 'test-channel-secret';
const LINE_USER = 'U1234567890abcdef';

type StubResult = {
  data: unknown;
  error: { message: string; code?: string } | null;
};

// Chainable, thenable query stub: filter methods record args and return the
// chain; awaiting resolves the configured result. maybeSingle resolves it too.
function chain(result: StubResult) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const stub: Record<string, unknown> = { calls };
  for (const method of [
    'select',
    'insert',
    'update',
    'delete',
    'eq',
    'gt',
    'lt',
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

function createService(options?: {
  configValues?: Record<string, string>;
  adminClient?: { from: jest.Mock };
}) {
  const apiClient = {
    issueLinkToken: jest.fn((_lineUserId: string) =>
      Promise.resolve('link-token-1'),
    ),
    pushMessage: jest.fn(
      (_to: string, _messages: Array<Record<string, unknown>>) =>
        Promise.resolve(),
    ),
    getProfile: jest.fn(() => Promise.resolve(null)),
  };
  const service = new LineService(
    {
      get: jest.fn(
        (key: string) =>
          (options?.configValues ?? { LINE_CHANNEL_SECRET: CHANNEL_SECRET })[
            key
          ],
      ),
    } as unknown as ConfigService,
    {
      getAdminClient: jest.fn(
        () => options?.adminClient ?? { from: jest.fn() },
      ),
    } as unknown as SupabaseService,
    apiClient as unknown as LineApiClient,
  );
  return { service, apiClient };
}

function sign(body: Buffer, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('base64');
}

describe('LineService', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('verifyWebhookSignature', () => {
    it('fails closed when LINE_CHANNEL_SECRET is not configured', () => {
      const { service } = createService({ configValues: {} });
      const body = Buffer.from('{}');

      expect(() =>
        service.verifyWebhookSignature(body, sign(body, CHANNEL_SECRET)),
      ).toThrow(UnauthorizedException);
    });

    it('rejects a missing signature', () => {
      const { service } = createService();
      expect(() =>
        service.verifyWebhookSignature(Buffer.from('{}'), undefined),
      ).toThrow(ForbiddenException);
    });

    it('rejects a signature computed with the wrong secret', () => {
      const { service } = createService();
      const body = Buffer.from('{"events":[]}');
      expect(() =>
        service.verifyWebhookSignature(body, sign(body, 'wrong-secret')),
      ).toThrow(ForbiddenException);
    });

    it('accepts a valid HMAC-SHA256 signature', () => {
      const { service } = createService();
      const body = Buffer.from('{"events":[]}');
      expect(() =>
        service.verifyWebhookSignature(body, sign(body, CHANNEL_SECRET)),
      ).not.toThrow();
    });
  });

  describe('follow events', () => {
    it('sends a link button to a not-yet-linked follower', async () => {
      const adminClient = buildAdminClient({
        profiles: [chain({ data: null, error: null })],
      });
      const { service, apiClient } = createService({ adminClient });

      await service.handleEvents([
        { type: 'follow', source: { userId: LINE_USER } },
      ]);

      expect(apiClient.issueLinkToken).toHaveBeenCalledWith(LINE_USER);
      expect(apiClient.pushMessage).toHaveBeenCalledTimes(1);
      const [to, messages] = apiClient.pushMessage.mock.calls[0];
      expect(to).toBe(LINE_USER);
      expect(messages[0].type).toBe('template');
      expect(JSON.stringify(messages[0])).toContain('linkToken=link-token-1');
    });

    it('sends an already-linked notice instead when the account is bound', async () => {
      const adminClient = buildAdminClient({
        profiles: [chain({ data: { id: 'user-1' }, error: null })],
      });
      const { service, apiClient } = createService({ adminClient });

      await service.handleEvents([
        { type: 'follow', source: { userId: LINE_USER } },
      ]);

      expect(apiClient.issueLinkToken).not.toHaveBeenCalled();
      expect(apiClient.pushMessage).toHaveBeenCalledTimes(1);
      const [, messages] = apiClient.pushMessage.mock.calls[0];
      expect(messages[0].type).toBe('text');
    });
  });

  describe('accountLink events', () => {
    const okEvent = {
      type: 'accountLink',
      source: { userId: LINE_USER },
      link: { result: 'ok', nonce: 'nonce-1' },
    };

    it('binds the profile, deletes the nonce, and confirms via DM', async () => {
      const nonceLookup = chain({
        data: { nonce: 'nonce-1', user_id: 'user-1', expires_at: 'later' },
        error: null,
      });
      const profileUpdate = chain({ data: null, error: null });
      const nonceDelete = chain({ data: null, error: null });
      const adminClient = buildAdminClient({
        cw_line_link_nonces: [nonceLookup, nonceDelete],
        profiles: [profileUpdate],
      });
      const { service, apiClient } = createService({ adminClient });

      await service.handleEvents([okEvent]);

      expect(profileUpdate.calls).toContainEqual({
        method: 'update',
        args: [{ line_id: LINE_USER }],
      });
      expect(profileUpdate.calls).toContainEqual({
        method: 'eq',
        args: ['id', 'user-1'],
      });
      expect(nonceDelete.calls).toContainEqual({
        method: 'delete',
        args: [],
      });
      const [, messages] = apiClient.pushMessage.mock.calls[0];
      expect(String(messages[0].text)).toContain('連携が完了');
    });

    it('does not bind when the nonce is missing or expired', async () => {
      const adminClient = buildAdminClient({
        cw_line_link_nonces: [chain({ data: null, error: null })],
      });
      const { service, apiClient } = createService({ adminClient });

      await service.handleEvents([okEvent]);

      const [, messages] = apiClient.pushMessage.mock.calls[0];
      expect(String(messages[0].text)).toContain('失敗');
    });

    it('sends an explanatory DM when the LINE account is linked elsewhere (23505)', async () => {
      const nonceLookup = chain({
        data: { nonce: 'nonce-1', user_id: 'user-1', expires_at: 'later' },
        error: null,
      });
      const profileUpdate = chain({
        data: null,
        error: { message: 'duplicate', code: '23505' },
      });
      const adminClient = buildAdminClient({
        cw_line_link_nonces: [nonceLookup],
        profiles: [profileUpdate],
      });
      const { service, apiClient } = createService({ adminClient });

      await service.handleEvents([okEvent]);

      const [, messages] = apiClient.pushMessage.mock.calls[0];
      expect(String(messages[0].text)).toContain('別のCropWatch');
    });

    it('ignores accountLink events with result=failed', async () => {
      const { service, apiClient } = createService();
      await service.handleEvents([
        {
          type: 'accountLink',
          source: { userId: LINE_USER },
          link: { result: 'failed' },
        },
      ]);
      expect(apiClient.pushMessage).not.toHaveBeenCalled();
    });
  });

  describe('unfollow and message events', () => {
    it('clears the link on unfollow', async () => {
      const profileUpdate = chain({ data: null, error: null });
      const adminClient = buildAdminClient({ profiles: [profileUpdate] });
      const { service } = createService({ adminClient });

      await service.handleEvents([
        { type: 'unfollow', source: { userId: LINE_USER } },
      ]);

      expect(profileUpdate.calls).toContainEqual({
        method: 'update',
        args: [{ line_id: null }],
      });
      expect(profileUpdate.calls).toContainEqual({
        method: 'eq',
        args: ['line_id', LINE_USER],
      });
    });

    it('re-sends the link button when an unbound user messages the bot', async () => {
      const adminClient = buildAdminClient({
        profiles: [chain({ data: null, error: null })],
      });
      const { service, apiClient } = createService({ adminClient });

      await service.handleEvents([
        { type: 'message', source: { userId: LINE_USER } },
      ]);

      expect(apiClient.issueLinkToken).toHaveBeenCalledWith(LINE_USER);
    });

    it('links the sender when an unbound user sends a valid 6-digit code', async () => {
      const isLinkedLookup = chain({ data: null, error: null });
      const profileUpdate = chain({ data: null, error: null });
      const codeLookup = chain({
        data: { nonce: '123456', user_id: 'user-1', expires_at: 'later' },
        error: null,
      });
      const codeDelete = chain({ data: null, error: null });
      const adminClient = buildAdminClient({
        profiles: [isLinkedLookup, profileUpdate],
        cw_line_link_nonces: [codeLookup, codeDelete],
      });
      const { service, apiClient } = createService({ adminClient });

      await service.handleEvents([
        {
          type: 'message',
          source: { userId: LINE_USER },
          message: { type: 'text', text: ' 123456 ' },
        },
      ]);

      expect(profileUpdate.calls).toContainEqual({
        method: 'update',
        args: [{ line_id: LINE_USER }],
      });
      expect(profileUpdate.calls).toContainEqual({
        method: 'eq',
        args: ['id', 'user-1'],
      });
      expect(apiClient.issueLinkToken).not.toHaveBeenCalled();
      const [, messages] = apiClient.pushMessage.mock.calls[0];
      expect(String(messages[0].text)).toContain('連携が完了');
    });

    it('replies invalid-code when the 6-digit code is unknown or expired', async () => {
      const adminClient = buildAdminClient({
        profiles: [chain({ data: null, error: null })],
        cw_line_link_nonces: [chain({ data: null, error: null })],
      });
      const { service, apiClient } = createService({ adminClient });

      await service.handleEvents([
        {
          type: 'message',
          source: { userId: LINE_USER },
          message: { type: 'text', text: '999999' },
        },
      ]);

      expect(apiClient.issueLinkToken).not.toHaveBeenCalled();
      const [, messages] = apiClient.pushMessage.mock.calls[0];
      expect(String(messages[0].text)).toContain('無効か期限切れ');
    });

    it('ignores messages from bound users', async () => {
      const adminClient = buildAdminClient({
        profiles: [chain({ data: { id: 'user-1' }, error: null })],
      });
      const { service, apiClient } = createService({ adminClient });

      await service.handleEvents([
        { type: 'message', source: { userId: LINE_USER } },
      ]);

      expect(apiClient.pushMessage).not.toHaveBeenCalled();
    });
  });

  describe('batch resilience', () => {
    it('continues the batch when one event handler throws', async () => {
      const failingLookup = chain({
        data: null,
        error: { message: 'boom' },
      });
      const okLookup = chain({ data: null, error: null });
      const adminClient = buildAdminClient({
        profiles: [failingLookup, okLookup],
      });
      const { service, apiClient } = createService({ adminClient });

      await service.handleEvents([
        { type: 'follow', source: { userId: 'U-bad' } },
        { type: 'follow', source: { userId: LINE_USER } },
      ]);

      // Second follow still processed despite the first one failing.
      expect(apiClient.issueLinkToken).toHaveBeenCalledWith(LINE_USER);
    });

    it('ignores unknown and malformed events', async () => {
      const { service, apiClient } = createService();
      await service.handleEvents([
        { type: 'sticker' },
        { type: 'follow' }, // no source.userId
        {} as never,
      ]);
      expect(apiClient.pushMessage).not.toHaveBeenCalled();
    });
  });

  describe('createLinkNonce / unlink', () => {
    it('purges expired nonces and inserts a fresh 10-minute nonce', async () => {
      const purge = chain({ data: null, error: null });
      const insert = chain({ data: null, error: null });
      const adminClient = buildAdminClient({
        cw_line_link_nonces: [purge, insert],
      });
      const { service } = createService({ adminClient });

      const { nonce } = await service.createLinkNonce('user-1');

      expect(purge.calls[0].method).toBe('delete');
      expect(Buffer.from(nonce, 'base64').length).toBe(24);
      const insertCall = insert.calls.find((c) => c.method === 'insert');
      expect(insertCall).toBeDefined();
      const row = (insertCall!.args[0] ?? {}) as Record<string, unknown>;
      expect(row.user_id).toBe('user-1');
      expect(row.nonce).toBe(nonce);
    });

    it('createLinkCode invalidates prior codes and mints a 6-digit code', async () => {
      const purgeExpired = chain({ data: null, error: null });
      const purgeUser = chain({ data: null, error: null });
      const insert = chain({ data: null, error: null });
      const adminClient = buildAdminClient({
        cw_line_link_nonces: [purgeExpired, purgeUser, insert],
      });
      const { service } = createService({ adminClient });

      const { code, expiresAt } = await service.createLinkCode('user-1');

      expect(code).toMatch(/^\d{6}$/);
      expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());
      expect(purgeUser.calls).toContainEqual({
        method: 'eq',
        args: ['user_id', 'user-1'],
      });
      const insertCall = insert.calls.find((c) => c.method === 'insert');
      const row = (insertCall!.args[0] ?? {}) as Record<string, unknown>;
      expect(row.nonce).toBe(code);
      expect(row.user_id).toBe('user-1');
    });

    it('unlink clears line_id for the current user', async () => {
      const profileUpdate = chain({ data: null, error: null });
      const adminClient = buildAdminClient({ profiles: [profileUpdate] });
      const { service } = createService({ adminClient });

      await service.unlink('user-1');

      expect(profileUpdate.calls).toContainEqual({
        method: 'update',
        args: [{ line_id: null }],
      });
      expect(profileUpdate.calls).toContainEqual({
        method: 'eq',
        args: ['id', 'user-1'],
      });
    });
  });
});
