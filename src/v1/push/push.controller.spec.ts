import { BadRequestException } from '@nestjs/common';
import { PushController } from './push.controller';
import type { PushService } from './push.service';

const USER = { sub: 'user-1', email: 'kevin@example.com', isStaff: false };

function createController() {
  const service = {
    registerToken: jest.fn(() => Promise.resolve()),
    unregisterToken: jest.fn(() => Promise.resolve()),
    listTokens: jest.fn(() => Promise.resolve([])),
    listEligibleRecipients: jest.fn(() => Promise.resolve([])),
  };
  return {
    controller: new PushController(service as unknown as PushService),
    service,
  };
}

describe('PushController', () => {
  it('registers a token for the current user', async () => {
    const { controller, service } = createController();

    await expect(
      controller.registerToken(USER, {
        token: 'fcm-token-1',
        deviceLabel: 'Pixel 9',
      }),
    ).resolves.toEqual({ registered: true });

    expect(service.registerToken).toHaveBeenCalledWith(
      'user-1',
      'fcm-token-1',
      'Pixel 9',
    );
  });

  it('unregisters a trimmed token for the current user', async () => {
    const { controller, service } = createController();

    await controller.unregisterToken(USER, '  fcm-token-1  ');

    expect(service.unregisterToken).toHaveBeenCalledWith(
      'user-1',
      'fcm-token-1',
    );
  });

  it('rejects unregister without a token', async () => {
    const { controller, service } = createController();

    await expect(controller.unregisterToken(USER, '  ')).rejects.toThrow(
      BadRequestException,
    );
    expect(service.unregisterToken).not.toHaveBeenCalled();
  });

  it('parses comma-separated devEuis for recipients', async () => {
    const { controller, service } = createController();

    await controller.listRecipients(USER, ' DEV-A , DEV-B ,, ');

    expect(service.listEligibleRecipients).toHaveBeenCalledWith(USER, [
      'DEV-A',
      'DEV-B',
    ]);
  });

  it('rejects recipients without devEuis', () => {
    const { controller, service } = createController();

    expect(() => controller.listRecipients(USER, '')).toThrow(
      BadRequestException,
    );
    expect(service.listEligibleRecipients).not.toHaveBeenCalled();
  });
});
