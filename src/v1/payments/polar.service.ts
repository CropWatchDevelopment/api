import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Polar } from '@polar-sh/sdk';
import { validateEvent, WebhookVerificationError } from '@polar-sh/sdk/webhooks';

export { WebhookVerificationError };

/** The validated Polar webhook event union (discriminated on `type`). */
export type PolarWebhookEvent = ReturnType<typeof validateEvent>;

/** Plain price descriptor decoupled from the SDK's price union. */
export interface PolarPriceInfo {
  amountType: string;
  priceAmount: number | null;
  priceCurrency: string | null;
}

/** Plain product descriptor for the billing UI. */
export interface PolarProductInfo {
  id: string;
  name: string;
  description: string | null;
  recurringInterval: string | null;
  prices: PolarPriceInfo[];
}

/** Plain subscription descriptor decoupled from the SDK's subscription type. */
export interface PolarSubscriptionInfo {
  id: string;
  productId: string;
  status: string;
  seats: number | null;
  discountId: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

/**
 * Thin wrapper around the Polar SDK. The rest of the codebase imports this
 * service and never the SDK directly, so the Polar surface stays in one place.
 */
@Injectable()
export class PolarService {
  private readonly logger = new Logger(PolarService.name);
  private readonly client: Polar;

  constructor(private readonly configService: ConfigService) {
    const accessToken = this.configService.get<string>('POLAR_ACCESS_TOKEN') ?? '';
    const server =
      (this.configService.get<string>('POLAR_SERVER') ?? 'sandbox') === 'production'
        ? 'production'
        : 'sandbox';

    if (!accessToken) {
      this.logger.error(
        'POLAR_ACCESS_TOKEN is not configured — Polar billing calls will fail',
      );
    }

    this.client = new Polar({ accessToken, server });
  }

  get baseProductId(): string {
    return this.configService.get<string>('POLAR_BASE_PRODUCT_ID') ?? '';
  }

  get deviceProductId(): string {
    return this.configService.get<string>('POLAR_DEVICE_PRODUCT_ID') ?? '';
  }

  get isWebhookConfigured(): boolean {
    return Boolean(this.configService.get<string>('POLAR_WEBHOOK_SECRET'));
  }

  private get checkoutSuccessUrl(): string {
    return this.configService.get<string>('POLAR_CHECKOUT_SUCCESS_URL') ?? '';
  }

  async listProducts(ids: string[]): Promise<PolarProductInfo[]> {
    const filtered = ids.filter((id) => id.length > 0);
    const iterator = await this.client.products.list(
      filtered.length ? { id: filtered } : {},
    );

    const products: PolarProductInfo[] = [];
    for await (const page of iterator) {
      for (const product of page.result.items) {
        products.push({
          id: product.id,
          name: product.name,
          description: product.description ?? null,
          recurringInterval: product.recurringInterval ?? null,
          prices: product.prices.map((price) => ({
            amountType: price.amountType,
            priceAmount:
              'priceAmount' in price
                ? price.priceAmount
                : 'seatTiers' in price
                  ? (price.seatTiers.tiers[0]?.pricePerSeat ?? null)
                  : null,
            priceCurrency: 'priceCurrency' in price ? price.priceCurrency : null,
          })),
        });
      }
    }
    return products;
  }

  async listSubscriptions(externalCustomerId: string): Promise<PolarSubscriptionInfo[]> {
    const iterator = await this.client.subscriptions.list({ externalCustomerId });

    const subscriptions: PolarSubscriptionInfo[] = [];
    for await (const page of iterator) {
      for (const subscription of page.result.items) {
        subscriptions.push(this.toSubscriptionInfo(subscription));
      }
    }
    return subscriptions;
  }

  async createCheckout(input: {
    productId: string;
    externalCustomerId: string;
    customerEmail?: string | null;
    discountId?: string | null;
    metadata?: Record<string, string | number | boolean>;
  }): Promise<string> {
    const checkout = await this.client.checkouts.create({
      products: [input.productId],
      successUrl: this.checkoutSuccessUrl || undefined,
      externalCustomerId: input.externalCustomerId,
      customerEmail: input.customerEmail ?? undefined,
      discountId: input.discountId ?? undefined,
      metadata: input.metadata,
    });
    return checkout.url;
  }

  async updateSeats(subscriptionId: string, seats: number): Promise<PolarSubscriptionInfo> {
    const subscription = await this.client.subscriptions.update({
      id: subscriptionId,
      subscriptionUpdate: { seats },
    });
    return this.toSubscriptionInfo(subscription);
  }

  async cancelSubscription(
    subscriptionId: string,
    atPeriodEnd: boolean,
  ): Promise<PolarSubscriptionInfo> {
    const subscription = await this.client.subscriptions.update({
      id: subscriptionId,
      subscriptionUpdate: atPeriodEnd
        ? { cancelAtPeriodEnd: true }
        : { revoke: true },
    });
    return this.toSubscriptionInfo(subscription);
  }

  async createPortalSession(externalCustomerId: string): Promise<string> {
    const session = await this.client.customerSessions.create({
      externalCustomerId,
    });
    return session.customerPortalUrl;
  }

  validateWebhook(
    body: Buffer | string,
    headers: Record<string, string>,
  ): PolarWebhookEvent {
    const secret = this.configService.get<string>('POLAR_WEBHOOK_SECRET') ?? '';
    return validateEvent(body, headers, secret);
  }

  private toSubscriptionInfo(subscription: {
    id: string;
    productId: string;
    status: string;
    seats?: number | null;
    discountId: string | null;
    currentPeriodEnd: Date | null;
    cancelAtPeriodEnd: boolean;
  }): PolarSubscriptionInfo {
    return {
      id: subscription.id,
      productId: subscription.productId,
      status: subscription.status,
      seats: subscription.seats ?? null,
      discountId: subscription.discountId,
      currentPeriodEnd: subscription.currentPeriodEnd
        ? subscription.currentPeriodEnd.toISOString()
        : null,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    };
  }
}
