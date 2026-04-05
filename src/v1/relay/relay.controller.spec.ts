import { Test, TestingModule } from '@nestjs/testing';
import { RelayController } from './relay.controller';
import { RelayService } from './relay.service';

describe('RelayController', () => {
  let controller: RelayController;
  let relayService: {
    getLatestRelay: jest.Mock;
    handleTtiUp: jest.Mock;
    pulseRelay: jest.Mock;
    updateRelay: jest.Mock;
  };

  beforeEach(async () => {
    relayService = {
      getLatestRelay: jest.fn(),
      handleTtiUp: jest.fn(),
      pulseRelay: jest.fn(),
      updateRelay: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RelayController],
      providers: [
        {
          provide: RelayService,
          useValue: relayService,
        },
      ],
    }).compile();

    controller = module.get<RelayController>(RelayController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('forwards the TTI downlink API key header to the relay service', () => {
    controller.handleTtiUp({ uplink_message: {} }, undefined, 'tti-token');

    expect(relayService.handleTtiUp).toHaveBeenCalledWith(
      { uplink_message: {} },
      undefined,
      'tti-token',
    );
  });

  it('forwards latest relay lookups to the relay service', () => {
    const req = {
      headers: {
        authorization: 'Bearer test-token',
      },
      user: {
        email: 'user@example.com',
        sub: 'user-1',
      },
    };

    controller.getLatestRelay('A8404194635A05FB', req);

    expect(relayService.getLatestRelay).toHaveBeenCalledWith(
      req.user,
      'Bearer test-token',
      'A8404194635A05FB',
    );
  });

  it('forwards timed relay pulse requests to the relay service', () => {
    const req = {
      headers: {
        authorization: 'Bearer test-token',
      },
      user: {
        email: 'user@example.com',
        sub: 'user-1',
      },
    };

    controller.pulseRelay(
      'A8404194635A05FB',
      {
        durationSeconds: 60,
        relay: 1,
      },
      req,
    );

    expect(relayService.pulseRelay).toHaveBeenCalledWith(
      req.user,
      'Bearer test-token',
      'A8404194635A05FB',
      {
        durationSeconds: 60,
        relay: 1,
      },
    );
  });
});
