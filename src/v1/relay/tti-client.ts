import { BadGatewayException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { TtiApplicationDownlink } from './relay-command-profile';

type FetchLike = typeof fetch;

export interface ReplaceDownlinkQueueInput {
  applicationId: string;
  deviceId: string;
  downlinks: TtiApplicationDownlink[];
}

export class TtiClientError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly detail: string | null = null,
  ) {
    super(message);
    this.name = 'TtiClientError';
  }
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

async function readResponseDetail(response: Response): Promise<string | null> {
  try {
    const text = readString(await response.text());
    if (!text) {
      return null;
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      return text;
    }

    const payload = JSON.parse(text) as Record<string, unknown>;
    const message = payload.message;

    if (typeof message === 'string' && message.trim()) {
      return message.trim();
    }

    if (Array.isArray(message)) {
      const joined = message
        .filter(
          (entry): entry is string =>
            typeof entry === 'string' && entry.trim().length > 0,
        )
        .join(', ');

      if (joined) {
        return joined;
      }
    }

    return text;
  } catch {
    return null;
  }
}

export function resolveTtiApplicationId(
  configuredValue: unknown,
  defaultApplicationId?: string | null,
): string | null {
  const configured = readString(configuredValue);
  if (configured) {
    return configured;
  }

  const fallback = readString(defaultApplicationId);
  return fallback || null;
}

export function readTtiBaseUrl(configService: ConfigService): string {
  const baseUrl = readString(configService.get<string>('PRIVATE_TTI_BASE_URL'));
  if (!baseUrl) {
    throw new ServiceUnavailableException('TTI base URL is not configured');
  }

  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
}

export function readTtiApiKey(configService: ConfigService): string {
  const apiKey = readString(configService.get<string>('PRIVATE_TTI_API_KEY'));
  if (!apiKey) {
    throw new ServiceUnavailableException('TTI API key is not configured');
  }

  return apiKey;
}

export function createTtiClient(
  configService: ConfigService,
  fetchFn: FetchLike = fetch,
) {
  const baseUrl = readTtiBaseUrl(configService);
  const apiKey = readTtiApiKey(configService);

  return {
    async replaceDownlinkQueue(
      input: ReplaceDownlinkQueueInput,
    ): Promise<unknown> {
      const url = new URL(
        `/api/v3/as/applications/${encodeURIComponent(input.applicationId)}/devices/${encodeURIComponent(input.deviceId)}/down/replace`,
        baseUrl,
      );

      const response = await fetchFn(url.toString(), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          downlinks: input.downlinks,
        }),
      });

      if (!response.ok) {
        throw new TtiClientError(
          response.status,
          `TTI request failed (${response.status})`,
          await readResponseDetail(response),
        );
      }

      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.includes('application/json')) {
        return null;
      }

      const text = await response.text();
      return text ? (JSON.parse(text) as unknown) : null;
    },
  };
}

export function mapTtiClientError(error: unknown): BadGatewayException {
  if (error instanceof TtiClientError) {
    const suffix = error.detail ? `: ${error.detail}` : '';
    return new BadGatewayException(
      `TTI relay request failed with status ${error.status}${suffix}`,
    );
  }

  return new BadGatewayException('TTI relay request failed');
}
