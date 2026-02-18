import {
  BadRequestException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CreateCheckoutSessionDto } from './dto/create-checkout-session.dto';
import { CreateCustomerPortalSessionDto } from './dto/create-customer-portal-session.dto';

@Injectable()
export class PaymentsService {
  constructor(private readonly configService: ConfigService) {}

  async createCheckoutSession(
    createCheckoutSessionDto: CreateCheckoutSessionDto,
    jwtPayload: any,
  ) {
    const userId = this.getUserId(jwtPayload);
    const products = Array.isArray(createCheckoutSessionDto.products)
      ? createCheckoutSessionDto.products
          .map((product) => product?.trim())
          .filter((product): product is string => Boolean(product))
      : [];

    if (products.length === 0) {
      throw new BadRequestException('products must contain at least one product ID');
    }
    for (const [index, productId] of products.entries()) {
      if (!this.isUuidV4(productId)) {
        throw new BadRequestException(`products[${index}] must be a valid UUID v4 product ID`);
      }
    }
    if (createCheckoutSessionDto.success_url) {
      this.assertAbsoluteHttpUrl('success_url', createCheckoutSessionDto.success_url);
    }
    if (createCheckoutSessionDto.return_url) {
      this.assertAbsoluteHttpUrl('return_url', createCheckoutSessionDto.return_url);
    }

    const payload: Record<string, unknown> = {
      products,
      external_customer_id: userId,
    };

    if (createCheckoutSessionDto.success_url) {
      payload.success_url = createCheckoutSessionDto.success_url;
    }
    if (createCheckoutSessionDto.return_url) {
      payload.return_url = createCheckoutSessionDto.return_url;
    }
    if (createCheckoutSessionDto.customer_name) {
      payload.customer_name = createCheckoutSessionDto.customer_name;
    }
    if (createCheckoutSessionDto.customer_email) {
      payload.customer_email = createCheckoutSessionDto.customer_email;
    }
    if (createCheckoutSessionDto.customer_billing_address) {
      payload.customer_billing_address = createCheckoutSessionDto.customer_billing_address;
    }
    if (createCheckoutSessionDto.metadata) {
      payload.metadata = createCheckoutSessionDto.metadata;
    }
    if (createCheckoutSessionDto.customer_metadata) {
      payload.customer_metadata = createCheckoutSessionDto.customer_metadata;
    }
    if (typeof createCheckoutSessionDto.allow_discount_codes === 'boolean') {
      payload.allow_discount_codes = createCheckoutSessionDto.allow_discount_codes;
    }
    if (typeof createCheckoutSessionDto.allow_trial === 'boolean') {
      payload.allow_trial = createCheckoutSessionDto.allow_trial;
    }

    return this.requestPolar<unknown>('/v1/checkouts', {
      method: 'POST',
      body: payload,
    });
  }

  async listSubscriptions(jwtPayload: any) {
    const userId = this.getUserId(jwtPayload);

    const response = await this.requestPolar<unknown>('/v1/subscriptions', {
      method: 'GET',
      query: {
        external_customer_id: userId,
        limit: 100,
      },
    });

    return response;
  }

  async listProducts() {
    return this.requestPolar<unknown>('/v1/products', {
      method: 'GET',
      query: {
        limit: 100,
      },
    });
  }

  async getCustomerState(jwtPayload: any) {
    const userId = this.getUserId(jwtPayload);

    return this.requestPolar<unknown>(
      `/v1/customers/external/${encodeURIComponent(userId)}/state`,
      {
        method: 'GET',
      },
    );
  }

  async createCustomerPortalSession(
    createCustomerPortalSessionDto: CreateCustomerPortalSessionDto,
    jwtPayload: any,
  ) {
    const userId = this.getUserId(jwtPayload);
    const payload: Record<string, unknown> = {
      external_customer_id: userId,
    };

    if (createCustomerPortalSessionDto.return_url) {
      payload.return_url = createCustomerPortalSessionDto.return_url;
    }

    return this.requestPolar<unknown>('/v1/customer-sessions', {
      method: 'POST',
      body: payload,
    });
  }

  async revokeSubscription(subscriptionId: string, jwtPayload: any) {
    const userId = this.getUserId(jwtPayload);
    const normalizedSubscriptionId = subscriptionId?.trim();
    if (!normalizedSubscriptionId) {
      throw new BadRequestException('subscription id is required');
    }

    await this.assertSubscriptionOwnership(normalizedSubscriptionId, userId);

    return this.requestPolar<unknown>(
      `/v1/subscriptions/${encodeURIComponent(normalizedSubscriptionId)}`,
      {
        method: 'DELETE',
      },
    );
  }

  private getUserId(jwtPayload: any): string {
    const userId = jwtPayload?.sub;
    if (typeof userId !== 'string' || !userId.trim()) {
      throw new UnauthorizedException('Invalid bearer token');
    }
    return userId;
  }

  private isUuidV4(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    );
  }

  private assertAbsoluteHttpUrl(fieldName: string, value: string): void {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new BadRequestException(`${fieldName} must be an absolute URL`);
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new BadRequestException(`${fieldName} must use http or https`);
    }
  }

  private getPolarAccessToken(): string {
    const token = this.configService.get<string>('POLAR_ACCESS_TOKEN')?.trim();
    if (!token) {
      throw new InternalServerErrorException('POLAR_ACCESS_TOKEN is not configured');
    }
    return token;
  }

  private getPolarApiBaseUrl(): string {
    const configuredBaseUrl = this.configService.get<string>('POLAR_API_URL')?.trim();
    const baseUrl =
      configuredBaseUrl && configuredBaseUrl.length > 0
        ? configuredBaseUrl
        : 'https://api.polar.sh';
    return baseUrl.replace(/\/+$/, '');
  }

  private buildPolarUrl(path: string, query?: Record<string, string | number | boolean>): string {
    const baseUrl = this.getPolarApiBaseUrl();
    const url = new URL(path, `${baseUrl}/`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  private extractPolarErrorMessage(payload: unknown, fallback: string): string {
    if (typeof payload === 'string' && payload.trim()) {
      return payload;
    }

    if (payload && typeof payload === 'object') {
      const polarError = payload as {
        detail?: string | Array<{ loc?: unknown[]; msg?: string; message?: string }>;
        message?: string;
        error?: string;
        errors?: Array<{ message?: string; msg?: string }>;
      };

      if (Array.isArray(polarError.detail)) {
        const joined = polarError.detail
          .map((entry) => {
            const path = Array.isArray(entry.loc)
              ? entry.loc
                  .map((part) => (typeof part === 'string' ? part : String(part)))
                  .join('.')
              : '';
            const msg = entry.msg ?? entry.message ?? '';
            return path && msg ? `${path}: ${msg}` : msg || path;
          })
          .filter((entry): entry is string => Boolean(entry))
          .join('; ');
        if (joined) {
          return joined;
        }
      }

      if (typeof polarError.detail === 'string' && polarError.detail.trim()) {
        return polarError.detail;
      }
      if (typeof polarError.message === 'string' && polarError.message.trim()) {
        return polarError.message;
      }
      if (typeof polarError.error === 'string' && polarError.error.trim()) {
        return polarError.error;
      }
      if (Array.isArray(polarError.errors)) {
        const joined = polarError.errors
          .map((entry) => entry?.message ?? entry?.msg)
          .filter((entry): entry is string => Boolean(entry))
          .join(', ');
        if (joined) {
          return joined;
        }
      }
    }

    return fallback;
  }

  private async requestPolar<T>(
    path: string,
    options: {
      method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
      query?: Record<string, string | number | boolean>;
      body?: unknown;
    },
  ): Promise<T> {
    const accessToken = this.getPolarAccessToken();
    const url = this.buildPolarUrl(path, options.query);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
    };

    let body: string | undefined;
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    }

    const response = await fetch(url, {
      method: options.method,
      headers,
      body,
    });

    const responseText = await response.text();
    let payload: unknown = null;
    if (responseText) {
      try {
        payload = JSON.parse(responseText);
      } catch {
        payload = responseText;
      }
    }

    if (!response.ok) {
      const fallback = `Polar API request failed with status ${response.status}`;
      const message = this.extractPolarErrorMessage(payload, fallback);
      throw new HttpException(message, response.status);
    }

    return payload as T;
  }

  private async assertSubscriptionOwnership(
    subscriptionId: string,
    userId: string,
  ): Promise<void> {
    const subscription = await this.requestPolar<{
      id: string;
      customer_id?: string | null;
      customer?: { external_id?: string | null };
    }>(`/v1/subscriptions/${encodeURIComponent(subscriptionId)}`, { method: 'GET' });

    if (subscription.customer?.external_id === userId) {
      return;
    }

    if (subscription.customer_id) {
      const customer = await this.requestPolar<{ external_id?: string | null }>(
        `/v1/customers/${encodeURIComponent(subscription.customer_id)}`,
        { method: 'GET' },
      );

      if (customer.external_id === userId) {
        return;
      }
    }

    throw new NotFoundException('Subscription not found for authenticated user');
  }
}
