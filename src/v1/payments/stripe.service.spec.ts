import { ConfigService } from '@nestjs/config';
import type Stripe from 'stripe';
import { StripeService } from './stripe.service';

describe('StripeService', () => {
  const createService = (env: Record<string, string> = {}) =>
    new StripeService({
      get: jest.fn((key: string) => env[key]),
    } as unknown as ConfigService);

  it('constructs without a secret key instead of crashing at boot', () => {
    expect(() => createService()).not.toThrow();
  });

  it('resolvePriceIds prefers env overrides without calling Stripe', async () => {
    const service = createService({
      STRIPE_SECRET_KEY: 'sk_test_dummy',
      STRIPE_BASE_PRICE_ID: 'price_base_env',
      STRIPE_DEVICE_PRICE_ID: 'price_device_env',
    });

    await expect(service.resolvePriceIds()).resolves.toEqual({
      basePriceId: 'price_base_env',
      devicePriceId: 'price_device_env',
    });
  });

  describe('toSubscriptionInfo', () => {
    it('maps the billing period from the subscription item (API >= 2025-03-31)', () => {
      const service = createService({ STRIPE_SECRET_KEY: 'sk_test_dummy' });
      const subscription = {
        id: 'sub_1',
        status: 'active',
        cancel_at_period_end: true,
        discounts: ['di_1'],
        items: {
          data: [
            {
              id: 'si_1',
              quantity: 4,
              // Epoch seconds — lives on the item, not the subscription.
              current_period_end: 1767225600,
              price: { id: 'price_device' },
            },
          ],
        },
      } as unknown as Stripe.Subscription;

      expect(service.toSubscriptionInfo(subscription)).toEqual({
        id: 'sub_1',
        priceId: 'price_device',
        status: 'active',
        seats: 4,
        discountId: 'di_1',
        currentPeriodEnd: '2026-01-01T00:00:00.000Z',
        cancelAtPeriodEnd: true,
      });
    });

    it('tolerates a subscription with no items and expanded discounts', () => {
      const service = createService({ STRIPE_SECRET_KEY: 'sk_test_dummy' });
      const subscription = {
        id: 'sub_2',
        status: 'canceled',
        cancel_at_period_end: false,
        discounts: [{ id: 'di_2' }],
        items: { data: [] },
      } as unknown as Stripe.Subscription;

      expect(service.toSubscriptionInfo(subscription)).toEqual({
        id: 'sub_2',
        priceId: '',
        status: 'canceled',
        seats: null,
        discountId: 'di_2',
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
      });
    });
  });
});
