import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

/**
 * Stable lookup keys assigned to the recurring prices in Stripe (test AND
 * live mode — the bootstrap script creates both prices with these keys).
 * Price ids are resolved from these at runtime, so no env price ids are
 * needed; transfer a lookup key to a new price in Stripe to change pricing
 * without touching code or config.
 */
export const BASE_PRICE_LOOKUP_KEY = 'cropwatch_base_monthly';
export const DEVICE_PRICE_LOOKUP_KEY = 'cropwatch_device_seat_monthly';

/** The resolved Stripe price ids for the two subscription products. */
export interface BillingPriceIds {
  basePriceId: string;
  devicePriceId: string;
}

/** Plain price descriptor decoupled from the SDK's price type. */
export interface BillingPriceInfo {
  amountType: string;
  priceAmount: number | null;
  priceCurrency: string | null;
}

/** Plain product descriptor for the billing UI. */
export interface BillingProductInfo {
  id: string;
  name: string;
  description: string | null;
  recurringInterval: string | null;
  prices: BillingPriceInfo[];
}

/** Plain subscription descriptor decoupled from the SDK's subscription type. */
export interface BillingSubscriptionInfo {
  id: string;
  priceId: string;
  status: string;
  seats: number | null;
  discountId: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

/**
 * Thin wrapper around the Stripe SDK. The rest of the codebase imports this
 * service and never the SDK directly, so the Stripe surface stays in one place.
 *
 * Test vs live mode is selected by the secret key itself (sk_test_ / sk_live_).
 */
@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private readonly client: Stripe | null;

  constructor(private readonly configService: ConfigService) {
    const secretKey = this.configService.get<string>('STRIPE_SECRET_KEY') ?? '';
    if (!secretKey) {
      // new Stripe('') throws, which would crash the app at boot; degrade to
      // failing individual billing calls instead.
      this.logger.error(
        'STRIPE_SECRET_KEY is not configured — Stripe billing calls will fail',
      );
      this.client = null;
      return;
    }
    this.client = new Stripe(secretKey);
  }

  private get stripe(): Stripe {
    if (!this.client) {
      throw new Error('STRIPE_SECRET_KEY is not configured');
    }
    return this.client;
  }

  private priceIds: BillingPriceIds | null = null;

  /**
   * Resolve the base/device price ids: env override first, else look them up
   * by lookup key. Cached for the process lifetime once fully resolved.
   * Never throws — unresolved ids come back as '' (callers treat that as
   * "not configured"), so read paths keep degrading gracefully on an outage.
   */
  async resolvePriceIds(): Promise<BillingPriceIds> {
    if (this.priceIds) {
      return this.priceIds;
    }

    const envBase = this.configService.get<string>('STRIPE_BASE_PRICE_ID');
    const envDevice = this.configService.get<string>('STRIPE_DEVICE_PRICE_ID');
    if (envBase && envDevice) {
      this.priceIds = { basePriceId: envBase, devicePriceId: envDevice };
      return this.priceIds;
    }

    let basePriceId = envBase ?? '';
    let devicePriceId = envDevice ?? '';
    try {
      const prices = await this.stripe.prices.list({
        lookup_keys: [BASE_PRICE_LOOKUP_KEY, DEVICE_PRICE_LOOKUP_KEY],
        active: true,
      });
      for (const price of prices.data) {
        if (price.lookup_key === BASE_PRICE_LOOKUP_KEY) {
          basePriceId ||= price.id;
        } else if (price.lookup_key === DEVICE_PRICE_LOOKUP_KEY) {
          devicePriceId ||= price.id;
        }
      }
    } catch (error) {
      this.logger.warn(`Failed to resolve Stripe price ids: ${String(error)}`);
    }

    if (!basePriceId || !devicePriceId) {
      this.logger.error(
        `Stripe prices not found for lookup keys ${BASE_PRICE_LOOKUP_KEY} / ${DEVICE_PRICE_LOOKUP_KEY} — run scripts/stripe-bootstrap.mjs or set STRIPE_BASE_PRICE_ID / STRIPE_DEVICE_PRICE_ID`,
      );
      // Don't cache a partial result; retry on the next call.
      return { basePriceId, devicePriceId };
    }

    this.priceIds = { basePriceId, devicePriceId };
    return this.priceIds;
  }

  get isWebhookConfigured(): boolean {
    return Boolean(this.configService.get<string>('STRIPE_WEBHOOK_SECRET'));
  }

  private get checkoutSuccessUrl(): string {
    return this.configService.get<string>('STRIPE_CHECKOUT_SUCCESS_URL') ?? '';
  }

  private get billingReturnUrl(): string {
    return this.configService.get<string>('STRIPE_BILLING_RETURN_URL') ?? '';
  }

  /** Create the Stripe customer for a user (persisted by the caller). */
  async createCustomer(userId: string, email: string | null): Promise<string> {
    const customer = await this.stripe.customers.create({
      email: email ?? undefined,
      metadata: { user_id: userId },
    });
    return customer.id;
  }

  async listProducts(priceIds: string[]): Promise<BillingProductInfo[]> {
    const products: BillingProductInfo[] = [];
    for (const priceId of priceIds.filter((id) => id.length > 0)) {
      const price = await this.stripe.prices.retrieve(priceId, {
        expand: ['product'],
      });
      const product = price.product as Stripe.Product;
      products.push({
        id: priceId,
        name: product.name,
        description: product.description ?? null,
        recurringInterval: price.recurring?.interval ?? null,
        prices: [
          {
            amountType: price.billing_scheme,
            priceAmount: price.unit_amount,
            priceCurrency: price.currency,
          },
        ],
      });
    }
    return products;
  }

  async listSubscriptions(
    customerId: string,
  ): Promise<BillingSubscriptionInfo[]> {
    // Stripe's default list filter already excludes canceled subscriptions.
    const subscriptions = await this.stripe.subscriptions.list({
      customer: customerId,
      limit: 100,
    });
    return subscriptions.data.map((s) => this.toSubscriptionInfo(s));
  }

  async createCheckout(input: {
    priceId: string;
    customerId: string;
    userId: string;
    quantity?: number;
    adjustableQuantity?: boolean;
    promotionCodeId?: string | null;
  }): Promise<string> {
    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: input.customerId,
      client_reference_id: input.userId,
      line_items: [
        {
          price: input.priceId,
          quantity: input.quantity ?? 1,
          ...(input.adjustableQuantity
            ? { adjustable_quantity: { enabled: true, minimum: 1 } }
            : {}),
        },
      ],
      subscription_data: { metadata: { user_id: input.userId } },
      ...(input.promotionCodeId
        ? { discounts: [{ promotion_code: input.promotionCodeId }] }
        : { allow_promotion_codes: true }),
      success_url: this.checkoutSuccessUrl || undefined,
      cancel_url: this.billingReturnUrl || undefined,
    });
    if (!session.url) {
      throw new Error('Stripe checkout session has no redirect URL');
    }
    return session.url;
  }

  async updateSeats(
    subscriptionId: string,
    seats: number,
  ): Promise<BillingSubscriptionInfo> {
    const current = await this.stripe.subscriptions.retrieve(subscriptionId);
    const item = current.items.data[0];
    if (!item) {
      throw new Error(`Subscription ${subscriptionId} has no items`);
    }
    const updated = await this.stripe.subscriptions.update(subscriptionId, {
      items: [{ id: item.id, quantity: seats }],
      proration_behavior: 'create_prorations',
    });
    return this.toSubscriptionInfo(updated);
  }

  async cancelSubscription(
    subscriptionId: string,
    atPeriodEnd: boolean,
  ): Promise<BillingSubscriptionInfo> {
    const subscription = atPeriodEnd
      ? await this.stripe.subscriptions.update(subscriptionId, {
          cancel_at_period_end: true,
        })
      : await this.stripe.subscriptions.cancel(subscriptionId);
    return this.toSubscriptionInfo(subscription);
  }

  async createPortalSession(customerId: string): Promise<string> {
    const session = await this.stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: this.billingReturnUrl || undefined,
    });
    return session.url;
  }

  async retrieveSubscription(
    subscriptionId: string,
  ): Promise<BillingSubscriptionInfo> {
    const subscription =
      await this.stripe.subscriptions.retrieve(subscriptionId);
    return this.toSubscriptionInfo(subscription);
  }

  /** Resolve the CropWatch user id stored in the customer's metadata. */
  async retrieveCustomerUserId(customerId: string): Promise<string | null> {
    const customer = await this.stripe.customers.retrieve(customerId);
    if (customer.deleted) {
      return null;
    }
    return customer.metadata?.user_id ?? null;
  }

  constructWebhookEvent(
    rawBody: Buffer | string,
    signature: string,
  ): Stripe.Event {
    const secret =
      this.configService.get<string>('STRIPE_WEBHOOK_SECRET') ?? '';
    return this.stripe.webhooks.constructEvent(rawBody, signature, secret);
  }

  toSubscriptionInfo(
    subscription: Stripe.Subscription,
  ): BillingSubscriptionInfo {
    const item = subscription.items.data[0] ?? null;
    const discount = subscription.discounts?.[0] ?? null;
    return {
      id: subscription.id,
      priceId: item?.price.id ?? '',
      status: subscription.status,
      seats: item?.quantity ?? null,
      discountId:
        typeof discount === 'string' ? discount : (discount?.id ?? null),
      // As of Stripe API 2025-03-31 the billing period lives on the
      // subscription item, not the subscription.
      currentPeriodEnd: item?.current_period_end
        ? new Date(item.current_period_end * 1000).toISOString()
        : null,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
    };
  }
}
