import { ConfigService } from '@nestjs/config';
import { LineApiClient, LineApiError } from './line-api.client';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function createClient(configValues?: Record<string, string>) {
  return new LineApiClient({
    get: jest.fn(
      (key: string) =>
        (configValues ?? {
          LINE_CHANNEL_ID: 'channel-1',
          LINE_CHANNEL_SECRET: 'secret-1',
        })[key],
    ),
  } as unknown as ConfigService);
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

describe('LineApiClient', () => {
  let fetchMock: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  it('issues one stateless token and reuses it across calls', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(200, { access_token: 'tok-1', expires_in: 900 }),
      )
      .mockImplementation(() => Promise.resolve(jsonResponse(200, {})));

    const client = createClient();
    await client.pushMessage('U1', [{ type: 'text', text: 'a' }]);
    await client.pushMessage('U1', [{ type: 'text', text: 'b' }]);

    const tokenCalls = fetchMock.mock.calls.filter(([url]) =>
      urlOf(url).includes('/oauth2/v3/token'),
    );
    expect(tokenCalls).toHaveLength(1);

    const pushCalls = fetchMock.mock.calls.filter(([url]) =>
      urlOf(url).includes('/v2/bot/message/push'),
    );
    expect(pushCalls).toHaveLength(2);
    const pushInit = pushCalls[0][1];
    expect(pushInit.headers).toMatchObject({
      authorization: 'Bearer tok-1',
    });
  });

  it('refreshes the token once it is within the expiry margin', async () => {
    fetchMock
      .mockResolvedValueOnce(
        // expires_in 30s minus the 60s margin → immediately stale.
        jsonResponse(200, { access_token: 'tok-old', expires_in: 30 }),
      )
      .mockResolvedValueOnce(jsonResponse(200, {}))
      .mockResolvedValueOnce(
        jsonResponse(200, { access_token: 'tok-new', expires_in: 900 }),
      )
      .mockImplementation(() => Promise.resolve(jsonResponse(200, {})));

    const client = createClient();
    await client.pushMessage('U1', [{ type: 'text', text: 'a' }]);
    await client.pushMessage('U1', [{ type: 'text', text: 'b' }]);

    const tokenCalls = fetchMock.mock.calls.filter(([url]) =>
      urlOf(url).includes('/oauth2/v3/token'),
    );
    expect(tokenCalls).toHaveLength(2);
  });

  it('maps LINE error bodies to LineApiError with status and detail', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(200, { access_token: 'tok-1', expires_in: 900 }),
      )
      .mockResolvedValueOnce(
        jsonResponse(403, {
          message: 'Forbidden',
          details: [{ message: 'user blocked the bot' }],
        }),
      );

    const client = createClient();
    await expect(
      client.pushMessage('U1', [{ type: 'text', text: 'a' }]),
    ).rejects.toMatchObject({
      name: 'LineApiError',
      status: 403,
      detail: 'Forbidden; user blocked the bot',
    });
  });

  it('throws a configuration error when channel credentials are absent', async () => {
    const client = createClient({});
    await expect(
      client.pushMessage('U1', [{ type: 'text', text: 'a' }]),
    ).rejects.toBeInstanceOf(LineApiError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('issueLinkToken returns the token from the response body', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(200, { access_token: 'tok-1', expires_in: 900 }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { linkToken: 'link-abc' }));

    const client = createClient();
    await expect(client.issueLinkToken('U1')).resolves.toBe('link-abc');
    const linkCall = fetchMock.mock.calls.find(([url]) =>
      urlOf(url).includes('/v2/bot/user/U1/linkToken'),
    );
    expect(linkCall).toBeDefined();
  });
});
