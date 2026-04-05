import { BadGatewayException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createTtiClient,
  mapTtiClientError,
  resolveTtiApplicationId,
  TtiClientError,
} from './tti-client';
import { buildRelayDownlink } from './relay-command-profile';

function createJsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    headers: {
      'content-type': 'application/json',
    },
    status,
  });
}

describe('resolveTtiApplicationId', () => {
  it('uses the configured device-type application id before the env fallback', () => {
    expect(resolveTtiApplicationId('device-app', 'fallback-app')).toBe(
      'device-app',
    );
  });

  it('falls back to the provided default application id when the configured value is blank', () => {
    expect(resolveTtiApplicationId('', 'fallback-app')).toBe('fallback-app');
  });
});

describe('createTtiClient', () => {
  const configService = {
    get: jest.fn((key: string) => {
      if (key === 'PRIVATE_TTI_API_KEY') {
        return 'tti-secret';
      }

      if (key === 'PRIVATE_TTI_BASE_URL') {
        return 'https://tti.example.com';
      }

      return undefined;
    }),
  } as unknown as ConfigService;

  it('targets the TTI downlink replace endpoint with bearer auth and the queued payload', async () => {
    let requestUrl = '';
    let requestInit: RequestInit | undefined;
    const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input);
      requestInit = init;
      return createJsonResponse({});
    }) as typeof fetch;

    const client = createTtiClient(configService, fetchFn);

    await client.replaceDownlinkQueue({
      applicationId: 'dragino-ja-lt-22222',
      deviceId: 'relay-field-01',
      downlinks: [buildRelayDownlink(1, 'on', ['cropwatch:request:test'])],
    });

    expect(requestUrl).toBe(
      'https://tti.example.com/api/v3/as/applications/dragino-ja-lt-22222/devices/relay-field-01/down/replace',
    );
    expect(new Headers(requestInit?.headers).get('authorization')).toBe(
      'Bearer tti-secret',
    );
    expect(JSON.parse(String(requestInit?.body))).toEqual({
      downlinks: [
        {
          confirmed: false,
          correlation_ids: ['cropwatch:request:test'],
          f_port: 2,
          frm_payload: 'AwER',
          priority: 'NORMAL',
        },
      ],
    });
  });

  it('surfaces TTI error responses as structured client errors', async () => {
    const fetchFn = (async () =>
      createJsonResponse(
        {
          message:
            'error:pkg/auth/rights:no_application_rights (no rights for application `dragino-lt-22222@cropwatch`)',
        },
        403,
      )) as typeof fetch;

    const client = createTtiClient(configService, fetchFn);

    await expect(
      client.replaceDownlinkQueue({
        applicationId: 'dragino-lt-22222',
        deviceId: 'relay-field-01',
        downlinks: [buildRelayDownlink(1, 'on')],
      }),
    ).rejects.toMatchObject({
      detail:
        'error:pkg/auth/rights:no_application_rights (no rights for application `dragino-lt-22222@cropwatch`)',
      status: 403,
    });
  });
});

describe('mapTtiClientError', () => {
  it('includes the upstream TTI detail in the API exception message', () => {
    const exception = mapTtiClientError(
      new TtiClientError(
        403,
        'TTI request failed (403)',
        'error:pkg/auth/rights:no_application_rights (no rights for application `dragino-lt-22222@cropwatch`)',
      ),
    );

    expect(exception).toBeInstanceOf(BadGatewayException);
    expect(exception.message).toContain(
      'TTI relay request failed with status 403',
    );
    expect(exception.message).toContain(
      'no rights for application `dragino-lt-22222@cropwatch`',
    );
  });
});
