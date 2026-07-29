import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const LINE_API_BASE = 'https://api.line.me';
const TOKEN_URL = `${LINE_API_BASE}/oauth2/v3/token`;

// Refresh the stateless token one minute before LINE expires it (~15 min).
const TOKEN_EXPIRY_MARGIN_MS = 60_000;

export interface LineMessage {
  type: string;
  [key: string]: unknown;
}

export class LineApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly detail: string | null,
  ) {
    super(message);
    this.name = 'LineApiError';
  }
}

/**
 * Thin client for the LINE Messaging API. Authenticates with stateless
 * channel access tokens issued from the channel ID + secret — no token is
 * ever persisted (stateless tokens cannot be revoked and live 15 minutes).
 */
@Injectable()
export class LineApiClient {
  private readonly logger = new Logger(LineApiClient.name);
  private tokenCache: { token: string; expiresAtMs: number } | null = null;

  constructor(private readonly configService: ConfigService) {}

  get isConfigured(): boolean {
    return Boolean(
      this.configService.get<string>('LINE_CHANNEL_ID') &&
      this.configService.get<string>('LINE_CHANNEL_SECRET'),
    );
  }

  async issueLinkToken(lineUserId: string): Promise<string> {
    const response = await this.request<{ linkToken: string }>(
      'POST',
      `/v2/bot/user/${encodeURIComponent(lineUserId)}/linkToken`,
    );
    return response.linkToken;
  }

  async pushMessage(
    lineUserId: string,
    messages: LineMessage[],
  ): Promise<void> {
    await this.request('POST', '/v2/bot/message/push', {
      to: lineUserId,
      messages,
    });
  }

  async getProfile(
    lineUserId: string,
  ): Promise<{ displayName?: string } | null> {
    try {
      return await this.request<{ displayName?: string }>(
        'GET',
        `/v2/bot/profile/${encodeURIComponent(lineUserId)}`,
      );
    } catch (error) {
      // Profile lookup is cosmetic (display name in the confirmation DM);
      // a blocked bot or privacy setting must not fail the caller.
      this.logger.warn(`LINE profile lookup failed: ${String(error)}`);
      return null;
    }
  }

  private async getStatelessToken(): Promise<string> {
    if (this.tokenCache && this.tokenCache.expiresAtMs > Date.now()) {
      return this.tokenCache.token;
    }

    const channelId = this.configService.get<string>('LINE_CHANNEL_ID');
    const channelSecret = this.configService.get<string>('LINE_CHANNEL_SECRET');
    if (!channelId || !channelSecret) {
      throw new LineApiError(
        'LINE channel credentials not configured',
        0,
        null,
      );
    }

    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: channelId,
        client_secret: channelSecret,
      }),
    });

    if (!response.ok) {
      throw new LineApiError(
        `LINE token issuance failed with status ${response.status}`,
        response.status,
        await readResponseDetail(response),
      );
    }

    const body = (await response.json()) as {
      access_token: string;
      expires_in: number;
    };
    this.tokenCache = {
      token: body.access_token,
      expiresAtMs: Date.now() + body.expires_in * 1000 - TOKEN_EXPIRY_MARGIN_MS,
    };
    return body.access_token;
  }

  private async request<T = unknown>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const token = await this.getStatelessToken();
    const response = await fetch(`${LINE_API_BASE}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

    if (!response.ok) {
      throw new LineApiError(
        `LINE API ${method} ${path} failed with status ${response.status}`,
        response.status,
        await readResponseDetail(response),
      );
    }

    const text = await response.text();
    return (text ? JSON.parse(text) : {}) as T;
  }
}

// LINE error bodies are {message, details?: [{message, property}]}.
async function readResponseDetail(response: Response): Promise<string | null> {
  try {
    const text = await response.text();
    if (!text) return null;
    try {
      const parsed = JSON.parse(text) as {
        message?: unknown;
        details?: Array<{ message?: unknown }>;
      };
      const parts: string[] = [];
      if (typeof parsed.message === 'string') parts.push(parsed.message);
      for (const detail of parsed.details ?? []) {
        if (typeof detail?.message === 'string') parts.push(detail.message);
      }
      return parts.length > 0 ? parts.join('; ') : text;
    } catch {
      return text;
    }
  } catch {
    return null;
  }
}
